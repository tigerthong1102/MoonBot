import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ZaloEvent } from "../shared/zalo-event.ts";

export const ZALO_WEBHOOK_SKEW_MS = 5 * 60_000;
const MAX_PENDING = 4096;
const DAY = 86_400_000;
type Grant = { grantId: string; senderId: string; conversationId: string; since: number; retentionDays: number };

export function webhookClock(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS zalo_webhook_early (
    endpoint TEXT NOT NULL REFERENCES zalo_webhook_endpoints ON DELETE CASCADE, fingerprint BLOB NOT NULL,
    epoch TEXT, sourceTime INTEGER NOT NULL, PRIMARY KEY(endpoint,fingerprint)
  );
  CREATE INDEX IF NOT EXISTS zalo_webhook_early_time ON zalo_webhook_early(sourceTime);
  CREATE TABLE IF NOT EXISTS zalo_webhook_clock_holds (
    endpoint TEXT PRIMARY KEY REFERENCES zalo_webhook_endpoints ON DELETE CASCADE
  )`);
  const note = (grant: Grant, now: number, reason: string) => db.prepare(`INSERT INTO zalo_webhook_time_gaps(grantId,reason,observed,expires)
    VALUES(?,?,?,?) ON CONFLICT(grantId,reason) DO UPDATE SET observed=excluded.observed, expires=excluded.expires`)
    .run(grant.grantId, reason, now, now + grant.retentionDays * DAY);
  function prune(now: number) {
    db.prepare(`DELETE FROM zalo_webhook_early WHERE sourceTime <= ? AND NOT EXISTS (
      SELECT 1 FROM zalo_webhook_endpoints e JOIN zalo_grants g ON g.grantId=e.grantId
      WHERE e.endpoint=zalo_webhook_early.endpoint AND g.since < sourceTime
      AND g.grantId IS NOT epoch AND ? < sourceTime + g.retentionDays*86400000)`).run(now, now);
  }
  return {
    prune,
    assess(endpoint: string, secret: string, event: ZaloEvent, activeGrant: Grant | undefined, receivedEpoch: string | null, now: number): number | undefined {
      const grant = activeGrant?.conversationId === event.conversationId && activeGrant.senderId === event.senderId ? activeGrant : undefined;
      if (db.prepare("SELECT 1 FROM zalo_webhook_clock_holds WHERE endpoint=?").get(endpoint)) {
        if (grant) note(grant, now, "clock-capacity");
        return 503;
      }
      const fingerprint = createHmac("sha256", secret).update(JSON.stringify([event.conversationId, event.messageId])).digest();
      const prior = db.prepare("SELECT epoch FROM zalo_webhook_early WHERE endpoint=? AND fingerprint=?").get(endpoint, fingerprint);
      if (prior && (!grant || prior.epoch !== grant.grantId)) {
        if (grant) note(grant, now, "observed-outside-grant");
        return 204;
      }
      const observedUnderGrant = grant !== undefined && grant.grantId === receivedEpoch;
      const crossedEnrollment = grant !== undefined && !observedUnderGrant && event.timestamp > grant.since;
      if ((event.timestamp > now || crossedEnrollment) && !prior) {
        if (Number(db.prepare("SELECT COUNT(*) AS n FROM zalo_webhook_early WHERE endpoint=?").get(endpoint)?.n) >= MAX_PENDING) {
          db.prepare("INSERT OR IGNORE INTO zalo_webhook_clock_holds(endpoint) VALUES(?)").run(endpoint);
          if (grant) note(grant, now, "clock-capacity");
          return 503;
        }
        db.prepare("INSERT INTO zalo_webhook_early(endpoint,fingerprint,epoch,sourceTime) VALUES(?,?,?,?)")
          .run(endpoint, fingerprint, observedUnderGrant ? receivedEpoch : null, event.timestamp);
      }
      if (!grant) return 204;
      if (!observedUnderGrant) {
        note(grant, now, "observed-outside-grant");
        return 204;
      }
      if (event.timestamp <= grant.since) {
        note(grant, now, "before-grant");
        return 204;
      }
      if (event.timestamp > now + ZALO_WEBHOOK_SKEW_MS) {
        note(grant, now, "provider-clock-ahead");
        return 503;
      }
      return undefined;
    },
  };
}
