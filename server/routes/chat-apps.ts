import { APP_LIMITS, ROOM_VIEW_ONLY, type AppPayload } from "../../shared/app.ts";
import { APP_RPC_METHODS, type AppRpcMethod } from "../../shared/app-frame/bridge.ts";
import { webOrigin } from "../../shared/app-frame/csp.ts";
import { appRow, createChatApps, rowRate, type ChatApps } from "../chat-apps.ts";
import { changeReportSection, reportSections } from "../pages/report-sections.ts";
import { messageFileDisposition } from "../message-file.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord, Message, Store } from "../store.ts";
import { refusalBody, userError } from "../user-errors.ts";
import { PASS, type RouteHandler } from "./table.ts";

export { createChatApps };
export { createChatAppsMcp } from "../chat-apps-mcp.ts";

export interface McpRpcRequest {
  auth: RequestAuth;
  bot: BotRecord;
  threadId: string;
  row: Message & { app: AppPayload };
  method: AppRpcMethod;
  params: Record<string, unknown>;
}

/** The JSON-RPC `result`, or {error: {code, message}, signIn?, blocked?}. */
export interface McpRpcAnswer {
  status: number;
  body: Record<string, unknown>;
}

export interface ChatAppRouteDeps {
  store: Pick<Store, "bot" | "botByThread" | "groupByThread" | "messagesFor" | "patchMessage" | "taskByThread">;
  apps: ChatApps;
  /** On a Cloud home, a guest changes only conversations it started. */
  threadRefusal?(auth: RequestAuth, threadId: string): string | null;
  /** Whether this person may see the conversation now: asked when its app is fetched and again for every file of a folder
   * page they load, so leaving a room, or losing sight of its bot, closes its pages to them. */
  threadVisible?(auth: RequestAuth, threadId: string): boolean;
  reportShareOrigins?(): { configured: string | null; detected: string | null };
  mcpRpc?(request: McpRpcRequest): Promise<McpRpcAnswer>;
}

const DOCUMENT = /^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/app(\/download)?$/;
const REPORT_SECTIONS = /^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/app\/sections$/;
const APP_ACTION = /^\/api\/bots\/([\w-]+)\/apps\/([\w-]+)\/(rpc|context)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createChatAppRoutes(deps: ChatAppRouteDeps): RouteHandler {
  const { store, apps } = deps;
  const contextRate = rowRate(120, 60_000);

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    let m = DOCUMENT.exec(path);
    if (m && method === "GET") {
      const threadId = m[1]!;
      // An unknown thread answers before the store materialises it.
      if (!store.botByThread(threadId) && !store.groupByThread(threadId)) return json(res, 404, { error: "no such conversation" });
      const visible = deps.threadVisible;
      if (visible && !visible(auth, threadId)) return json(res, 404, { error: "no such conversation" });
      if (!appRow(store, threadId, m[2]!)) return json(res, 404, { error: "no app on that message" });
      const asked = url.searchParams.get("rev");
      if (asked !== null && !/^\d{1,6}$/.test(asked)) return json(res, 400, { error: "rev must be a version number" });
      if (m[3]) {
        const page = apps.publishablePage(threadId, m[2]!, asked === null ? undefined : Number(asked));
        if (!page.ok) return json(res, page.status, refusalBody(page));
        if (page.files.length > 1) return json(res, 409, userError("serverError.page.downloadHasFiles"));
        const body = page.files[0]!.data;
        // Security: a bot's page is untrusted HTML; it leaves only as opaque bytes to save, never to render.
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(body.byteLength),
          "content-disposition": messageFileDisposition(`${page.title || "page"}.html`),
          "content-security-policy": "sandbox",
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        });
        res.end(body);
        return;
      }
      // A folder page's files load from wherever this client reaches the app; it names that origin itself.
      const origin = webOrigin(url.searchParams.get("origin")) ?? webOrigin(url.origin) ?? undefined;
      const viewer = { key: auth.kind === "session" ? `session:${auth.session.id}` : auth.kind, allowed: () => !visible || visible(auth, threadId) };
      const shareOrigin = url.searchParams.get("shareOrigin") === "1";
      const report = shareOrigin || url.searchParams.get("report") === "1";
      const doc = apps.appDocument(threadId, m[2]!, asked === null ? undefined : Number(asked), origin, viewer, report);
      if (!doc) return json(res, 404, userError(asked === null ? "serverError.page.notStored" : "serverError.page.versionGone"));
      res.setHeader("cache-control", "private, no-store");
      if (shareOrigin) {
        const origins = deps.reportShareOrigins?.();
        return json(res, 200, { configured: webOrigin(origins?.configured), detected: webOrigin(origins?.detected) });
      }
      if (report) {
        const sections = reportSections(threadId, m[2]!).flatMap(ref => {
          if (visible && !visible(auth, ref.threadId)) return [];
          const source = appRow(store, ref.threadId, ref.messageId);
          return source?.app.report && source.app.source === "html" ? [{ ...ref, title: source.app.title }] : [];
        });
        if (sections.length) doc.sections = sections;
      }
      return json(res, 200, doc);
    }

    m = REPORT_SECTIONS.exec(path);
    if (m && method === "POST") {
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only a workspace administrator can change report sections." });
      const [, threadId, messageId] = m as unknown as [string, string, string];
      const body = await readBody(req, 4096);
      if (!isRecord(body) || typeof body.sourceThread !== "string" || typeof body.sourceMessage !== "string" ||
          !/^[\w-]{1,200}$/.test(body.sourceThread) || !/^[\w-]{1,200}$/.test(body.sourceMessage) ||
          (body.action !== "add" && body.action !== "remove") || (body.sourceThread === threadId && body.sourceMessage === messageId))
        return json(res, 400, { error: "Choose another internal report." });
      const shown = deps.threadVisible;
      if ((shown && (!shown(auth, threadId) || !shown(auth, body.sourceThread))) || !appRow(store, threadId, messageId)?.app.report ||
          !appRow(store, body.sourceThread, body.sourceMessage)?.app.report) return json(res, 404, userError("serverError.page.notStored"));
      const refused = deps.threadRefusal?.(auth, threadId);
      if (refused) return json(res, 403, { error: refused });
      const changed = changeReportSection(threadId, messageId, body.sourceThread, body.sourceMessage, body.action === "remove");
      return json(res, changed ? 200 : 409, changed ? { ok: true } : { error: "A report can include up to 12 source reports." });
    }

    m = APP_ACTION.exec(path);
    if (!m || method !== "POST") return PASS;
    const [, botId, messageId, action] = m as unknown as [string, string, string, "rpc" | "context"];
    const body = await readBody(req, action === "rpc" ? APP_LIMITS.rpcArgumentsBytes + 16_384 : 64_000);
    if (!isRecord(body) || typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId)) {
      return json(res, 400, { error: "threadId is required" });
    }
    const threadId = body.threadId;
    const bot = store.bot(botId);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (store.groupByThread(threadId)) return json(res, 409, { error: ROOM_VIEW_ONLY });
    if (!store.taskByThread(bot.id, threadId)) return json(res, 404, { error: "no such conversation" });
    const refused = deps.threadRefusal?.(auth, threadId);
    if (refused) return json(res, 403, { error: refused });
    const row = appRow(store, threadId, messageId);
    if (!row || (row.from && row.from.botId !== bot.id)) return json(res, 404, { error: "That app is not in this conversation." });

    if (action === "context") {
      if (!contextRate.take(`${threadId}:${row.id}`)) return json(res, 429, { error: "Too many context updates from this app." });
      const result = apps.setAppContext({ threadId, messageId: row.id, content: body.content, structuredContent: body.structuredContent });
      return result.ok ? json(res, 200, { ok: true }) : json(res, result.status, { error: result.error });
    }

    if (row.app.source !== "mcp") return json(res, 404, { error: "That app has no server to call." });
    if (typeof body.method !== "string" || !(APP_RPC_METHODS as readonly string[]).includes(body.method)) {
      return json(res, 400, { error: `method must be one of ${APP_RPC_METHODS.join(", ")}` });
    }
    if (body.params !== undefined && !isRecord(body.params)) return json(res, 400, { error: "params must be an object" });
    if (!deps.mcpRpc) return json(res, 404, { error: "This app cannot reach its server on this computer yet." });
    const answer = await deps.mcpRpc({
      auth, bot, threadId, row,
      method: body.method as McpRpcRequest["method"],
      params: isRecord(body.params) ? body.params : {},
    });
    return json(res, answer.status, answer.body);
  };
}
