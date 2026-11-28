import { homedir } from "node:os";
import type { Server } from "node:http";
import { openZaloPrivateDatabase } from "./zalo-private-database.ts";
import { createZaloWebhookPilot } from "./zalo-webhook.ts";
import { zaloPairingEnabled } from "./routes/zalo-official.ts";

/** A running local pilot cleans an idle inbox on startup and every five minutes. Reads enforce expiry immediately. */
export function attachZaloRetention(server: Pick<Server, "once">, desktop: boolean, home = homedir) {
  if (!desktop || !zaloPairingEnabled()) return;
  function sweep() {
    if (!zaloPairingEnabled()) return;
    let db;
    try {
      db = openZaloPrivateDatabase(home(), "inbox.sqlite");
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='zalo_webhook_endpoints'").get()) {
        createZaloWebhookPilot(db).purgeExpired();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Zalo private inbox cleanup could not run.");
    } finally { db?.close(); }
  }
  server.once("listening", () => {
    sweep();
    const timer = setInterval(sweep, 5 * 60_000);
    timer.unref();
    server.once("close", () => clearInterval(timer));
  });
}
