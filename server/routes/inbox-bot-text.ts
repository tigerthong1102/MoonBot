import { z } from "zod";
import type { SideJobs } from "../side-jobs.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { registeredBotUsernames } from "../../shared/bot-username.ts";

interface InboxBot {
  id: string;
  name: string;
  hidden?: boolean;
  groupUsername?: string;
}
interface Deps {
  desktop: boolean;
  bots(): InboxBot[];
  held(id: string): boolean;
  jobs: SideJobs;
  workspaceId?(): string;
  saveIdentity?(id: string, workspaceId: string, identity: { username: string; publicKey: string }): boolean;
  acquireWorkspace?(workspaceId: string): (() => void) | null;
  identityOwner?(req: import("node:http").IncomingMessage): boolean;
}
const request = z.object({
  id: z.string().max(160),
  topic: z.string().min(1).max(1800),
  prior: z.string().max(2400).nullable(),
  locale: z.string().max(20),
  workspaceId: z.string().uuid().optional(),
});

export function inboxBotTextRoutes(deps: Deps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/personal-inbox/bots" && path !== "/api/personal-inbox/bot-identity") return PASS;
    if (
      !deps.desktop ||
      auth.kind !== "loopback" ||
      auth.trust === "service" ||
      auth.companionDevice
    )
      return void json(res, 403, { error: "unavailable" });
    const bots = deps.bots().filter((b) => !b.hidden && !deps.held(b.id));
    if (path === "/api/personal-inbox/bot-identity") {
      if (!deps.workspaceId || !deps.saveIdentity) return void json(res, 503, { error: "unavailable" });
      if (method === "GET") return void json(res, 200, { workspaceId: deps.workspaceId() });
      if (method !== "POST") return void json(res, 405, { error: "method_not_allowed" });
      if (!deps.identityOwner?.(req)) return void json(res, 403, { error: "unavailable" });
      const input = z.object({ id: z.string().min(1).max(160), workspaceId: z.string().uuid(), username: z.string().regex(/^bot_k[a-f0-9]{64}$/), publicKey: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await readBody(req, 16384).catch(() => null));
      if (!input.success) return void json(res, 400, { error: "invalid_request" });
      if (!deps.bots().some(bot => bot.id === input.data.id && !bot.hidden && !deps.held(bot.id)) || !deps.saveIdentity(input.data.id, input.data.workspaceId, input.data)) return void json(res, 409, { error: "unavailable" });
      return void json(res, 200, { ok: true });
    }
    if (method === "GET") {
      const usernames = registeredBotUsernames(deps.bots());
      return void json(res, 200, {
        bots: bots
          .filter((b) => deps.jobs.text("inbox-discussion", b.id))
          .map((b) => ({ id: b.id, name: b.name, ...(usernames.has(b.id) ? { username: usernames.get(b.id) } : {}) })),
      });
    }
    if (method !== "POST")
      return void json(res, 405, { error: "method_not_allowed" });
    const parsed = request.safeParse(
      await readBody(req, 16384).catch(() => null),
    );
    if (!parsed.success)
      return void json(res, 400, { error: "invalid_request" });
    const { id, topic, prior, locale, workspaceId } = parsed.data;
    const release = workspaceId ? deps.acquireWorkspace?.(workspaceId) : undefined;
    if (workspaceId && !release) return void json(res, 409, { error: "workspace_changed" });
    try {
    const bot = bots.find((b) => b.id === id);
    const writer = bot && deps.jobs.text("inbox-discussion", id);
    if (!writer || !bot) return void json(res, 404, { error: "unavailable" });
    const prompt = [
      "Write one short reply for the shared discussion. Write in the requested language. Reply to the topic and, if present, the other bot's reply. Do not claim to have performed actions.",
      prior ? "You are the second speaker. Build on the first speaker’s concrete answer." : "You are the first speaker. Give a concrete answer to the topic.",
      JSON.stringify({
        name: bot.name,
        language: locale,
        topic,
        previousReply: prior,
      }),
    ].join("\n");
    const result = await writer.generateText(prompt, { timeoutMs: 60_000 });
    return void json(res, 200, {
      text: redactSecretsInText(result.trim().slice(0, 2400)),
    });
    } finally { release?.(); }
  };
}
