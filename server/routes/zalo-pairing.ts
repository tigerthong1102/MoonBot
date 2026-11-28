import { homedir } from "node:os";
import { z } from "zod";
import { createZaloWebhookPilot } from "../zalo-webhook.ts";
import { openZaloPrivateDatabase } from "../zalo-private-database.ts";
import { zaloWrite } from "../zalo-write.ts";
import { isZaloDesktopOwner, zaloPairingEnabled } from "./zalo-official.ts";
import { PASS, type RouteHandler } from "./table.ts";

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), revision }).strict(),
  z.object({ action: z.literal("approve"), revision, senderId: id, conversationId: id, retentionDays: z.number().int().min(1).max(365) }).strict(),
  z.object({ action: z.literal("revoke"), revision }).strict(),
]);

export function createZaloPairingRoutes(localDesktop: boolean, home = homedir): RouteHandler {
  return async ({ req, res, path, method, auth, readBody, json }) => {
    if (path !== "/api/zalo-official/pairing") return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!isZaloDesktopOwner(localDesktop, auth) || !zaloPairingEnabled()) return json(res, 403, { error: "pilot-unavailable" });
    if (method !== "GET" && method !== "POST") return json(res, 405, { error: "method-not-allowed" });
    let input: z.infer<typeof action> | undefined;
    if (method === "POST") {
      if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "json-required" });
      try {
        const body = await readBody(req, 2048);
        const parsed = action.safeParse(body);
        if (body && typeof body === "object") for (const key of Object.keys(body)) delete (body as Record<string, unknown>)[key];
        if (!parsed.success) return json(res, 400, { error: "invalid-action" });
        input = parsed.data;
      } catch { return json(res, 400, { error: "invalid-action" }); }
    }
    if (res.destroyed) return;
    if (!zaloPairingEnabled()) return json(res, 403, { error: "pilot-unavailable" });
    const missing = () => json(res, input ? 409 : 200, input ? { error: "pairing-changed" } : { state: "unconfigured" });
    const accountId = process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID;
    if (!id.safeParse(accountId).success || !accountId) return missing();
    let db;
    try { db = openZaloPrivateDatabase(home(), "inbox.sqlite"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing();
      return json(res, 503, { error: "private-inbox-unavailable" });
    }
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='zalo_webhook_endpoints'").get()) return missing();
      const pilot = createZaloWebhookPilot(db);
      const result = zaloWrite(db, () => {
        const current = pilot.inspect(accountId);
        if (!current) return input ? undefined : { state: "unconfigured" };
        if (!input) return current.status;
        if (current.status.revision !== input.revision) return;
        if (input.action === "revoke") {
          pilot.remove(current.endpoint);
          return { state: "unconfigured" };
        }
        let command: string | undefined;
        if (input.action === "invite") {
          if (current.status.state === "paired") return;
          command = "/pair " + pilot.invite(current.endpoint).code;
        } else {
          if (!current.pairId || current.status.participant?.senderId !== input.senderId ||
              current.status.participant.conversationId !== input.conversationId) return;
          pilot.approve(current.endpoint, { id: current.pairId, senderId: input.senderId, conversationId: input.conversationId }, input.retentionDays);
        }
        return { ...pilot.inspect(accountId)!.status, ...(command ? { command } : {}) };
      });
      return result ? json(res, 200, result) : json(res, 409, { error: "pairing-changed" });
    } catch { return json(res, 503, { error: "private-inbox-unavailable" }); }
    finally { db.close(); }
  };
}
