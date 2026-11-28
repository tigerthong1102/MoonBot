import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { z } from "zod";
import { createZaloInbox } from "../zalo-inbox.ts";
import { openZaloPrivateDatabase } from "../zalo-private-database.ts";
import { createZaloWebhookPilot } from "../zalo-webhook.ts";
import { zaloWrite } from "../zalo-write.ts";
import { isZaloDesktopOwner, zaloPairingEnabled } from "./zalo-official.ts";
import { PASS, type RouteHandler } from "./table.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const interval = z.object({
  revision: digest,
  start: z.number().int().nonnegative().safe(),
  end: z.number().int().nonnegative().safe(),
});
const command = z.discriminatedUnion("action", [
  interval.extend({ action: z.literal("preview") }).strict(),
  interval.extend({ action: z.literal("erase"), confirmation: digest }).strict(),
]);

export function createZaloErasureRoutes(localDesktop: boolean, home = homedir): RouteHandler {
  return async ({ req, res, path, method, auth, readBody, json }) => {
    if (path !== "/api/zalo-official/erasure") return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!isZaloDesktopOwner(localDesktop, auth) || !zaloPairingEnabled()) return json(res, 403, { error: "pilot-unavailable" });
    if (method !== "POST") return json(res, 405, { error: "method-not-allowed" });
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "json-required" });
    let input: z.infer<typeof command>;
    try { input = command.parse(await readBody(req, 2048)); }
    catch { return json(res, 400, { error: "invalid-erasure" }); }
    if (input.end < input.start || input.end > Date.now()) return json(res, 400, { error: "invalid-interval" });
    if (res.destroyed) return;
    if (!zaloPairingEnabled()) return json(res, 403, { error: "pilot-unavailable" });
    const changed = () => json(res, 409, { error: "source-changed" });
    const accountId = process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID;
    if (!accountId) return changed();
    let db;
    try { db = openZaloPrivateDatabase(home(), "inbox.sqlite"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return changed();
      return json(res, 503, { error: "private-inbox-unavailable" });
    }
    try {
      const pilot = createZaloWebhookPilot(db);
      const inbox = createZaloInbox(db);
      const result = zaloWrite(db, () => {
        const current = pilot.inspect(accountId);
        if (!current?.grantId || current.status.state !== "paired" || input.revision !== current.status.revision) return;
        const query = db.prepare("SELECT messageId,timestamp FROM zalo_events WHERE grantId=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp,messageId");
        const hash = createHash("sha256").update(JSON.stringify([current.grantId, input.start, input.end]));
        let count = 0;
        for (const row of query.iterate(current.grantId, input.start, input.end)) {
          hash.update(JSON.stringify([row.messageId, row.timestamp]));
          count++;
        }
        const confirmation = hash.digest("hex");
        if (input.action === "preview") return { count, confirmation };
        if (confirmation !== input.confirmation || count === 0) return;
        const erased = inbox.eraseInterval(current.grantId, input.start, input.end);
        const coverage = pilot.inspect(accountId)?.status.coverage;
        return { erased, coverage };
      });
      return result ? json(res, 200, result) : changed();
    } catch { return json(res, 503, { error: "private-inbox-unavailable" }); }
    finally { db.close(); }
  };
}
