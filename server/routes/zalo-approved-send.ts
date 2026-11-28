import { homedir } from "node:os";
import { z } from "zod";
import { createZaloReplyStore } from "../zalo-approved-send.ts";
import { openZaloPrivateDatabase } from "../zalo-private-database.ts";
import { isZaloDesktopOwner, zaloApprovedSendEnabled } from "./zalo-official.ts";
import { PASS, type RouteHandler } from "./table.ts";

const fields = { grantId: z.uuid(), sourceId: z.string().min(1).max(128), text: z.string().min(1).max(2000) };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ...fields }).strict(),
  z.object({ action: z.literal("send"), ...fields, actionId: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/),
    token: z.string().min(1).max(289), approvedByOwner: z.literal(true) }).strict(),
]);

export function createZaloReplyRoutes(local: boolean, home = homedir, request: typeof fetch = fetch): RouteHandler {
  return async ({ req, res, path, method, auth, readBody, json }) => {
    if (path !== "/api/zalo-official/reply") return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!isZaloDesktopOwner(local, auth) || !zaloApprovedSendEnabled()) return json(res, 403, { error: "pilot-unavailable" });
    if (method !== "GET" && method !== "POST") return json(res, 405, { error: "method-not-allowed" });
    const accountId = process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID;
    if (!accountId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(accountId)) return json(res, 409, { error: "unconfigured" });
    const allowed = () => zaloApprovedSendEnabled() && process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID === accountId;
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    res.once("close", disconnect);
    let db;
    try {
      let input: z.infer<typeof schema> | undefined;
      if (method === "POST") {
        if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "json-required" });
        const body = await readBody(req, 16_384);
        const result = schema.safeParse(body);
        if (body && typeof body === "object") for (const k of Object.keys(body)) delete (body as Record<string, unknown>)[k];
        if (!result.success) return json(res, 400, { error: "invalid-action" });
        input = result.data;
      }
      if (controller.signal.aborted) return;
      if (!allowed()) return json(res, 403, { error: "pilot-unavailable" });
      db = openZaloPrivateDatabase(home(), "inbox.sqlite");
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='zalo_webhook_endpoints' AND type='table'").get()) return json(res, 409, { error: "unconfigured" });
      const store = createZaloReplyStore(db, accountId, allowed);
      if (!input) return json(res, 200, { source: store.source() ?? null });
      if (input.action === "preview") {
        const preview = store.preview(input, input.text);
        return preview ? json(res, 200, preview) : json(res, 409, { error: "source-or-text-unavailable" });
      }
      const result = await store.send(input, input.token, controller.signal, request);
      if (!controller.signal.aborted) return json(res, 200, result);
    } catch {
      if (!controller.signal.aborted) return json(res, 503, { error: "status-unavailable" });
    } finally { res.off("close", disconnect); db?.close(); }
  };
}
