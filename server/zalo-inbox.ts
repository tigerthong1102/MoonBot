import { purgeExpiredZaloReportHistory } from "./zalo-period-report.ts";
import { zaloWrite } from "./zalo-write.ts";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import type { ZaloEvent } from "../shared/zalo-event.ts";
import { zaloEventInput, zaloGrantInput, zaloInboxSchema } from "./zalo-inbox-schema.ts";

const DAY = 86_400_000;
type Scope = z.infer<typeof zaloGrantInput>;
type Grant = Scope & { grantId: string; since: number; lastPoll: number | null };
export type ZaloReceipt = "persisted" | "duplicate" | "conflict" | "revoked" | "expired";

/** The host supplies a private database dedicated to this principal, outside backup and cloud replication. */
export function createZaloInbox(db: DatabaseSync, now: () => number = Date.now) {
  db.exec(zaloInboxSchema);
  const write = <T>(operation: () => T) => zaloWrite(db, operation);
  const grant = (grantId: string) => db.prepare("SELECT * FROM zalo_grants WHERE grantId=?").get(grantId) as Grant | undefined;
  function prune(time: number) {
    db.prepare("DELETE FROM zalo_events WHERE expires <= ?").run(time);
    db.prepare("DELETE FROM zalo_poll_gaps WHERE expires <= ?").run(time);
    db.prepare("DELETE FROM zalo_webhook_time_gaps WHERE expires <= ?").run(time);
    db.prepare("DELETE FROM zalo_erased_ranges WHERE expires <= ?").run(time);
    db.prepare("DELETE FROM zalo_poll_leases WHERE until <= ? AND NOT EXISTS (SELECT 1 FROM zalo_grants WHERE grantId=grantedTo)").run(time);
  }
  function gap(scope: Grant, start: number, end: number) {
    if (end <= start) return;
    db.prepare("INSERT OR IGNORE INTO zalo_poll_gaps(grantId,start,end,expires) VALUES(?,?,?,?)")
      .run(scope.grantId, start, end, end + scope.retentionDays * DAY);
  }
  return {
    grant,
    enroll(input: Scope) {
      const scope = zaloGrantInput.safeParse(input);
      if (!scope.success || (input.adapter === "official" && input.conversationType !== "direct")) throw new Error("Invalid Zalo enrollment");
      const value = scope.data;
      const grantId = randomUUID();
      return write(() => {
        db.prepare("INSERT INTO zalo_grants(grantId,adapter,accountId,conversationId,conversationType,senderId,retentionDays,since) VALUES(?,?,?,?,?,?,?,?)")
          .run(grantId, value.adapter, value.accountId, value.conversationId, value.conversationType, value.senderId, value.retentionDays, now());
        return grantId;
      });
    },
    revoke(grantId: string) {
      return write(() => db.prepare("DELETE FROM zalo_grants WHERE grantId=?").run(grantId).changes === 1);
    },
    revokeAccount(adapter: Scope["adapter"], accountId: string) {
      return write(() => Number(db.prepare("DELETE FROM zalo_grants WHERE adapter=? AND accountId=?").run(adapter, accountId).changes));
    },
    revokeConversation(scope: Pick<Scope, "adapter" | "accountId" | "conversationType" | "conversationId">) {
      return write(() => Number(db.prepare("DELETE FROM zalo_grants WHERE adapter=? AND accountId=? AND conversationType=? AND conversationId=?")
        .run(scope.adapter, scope.accountId, scope.conversationType, scope.conversationId).changes));
    },
    eraseInterval(grantId: string, start: number, end: number) {
      return write(() => {
        const time = now();
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > time) throw new Error("Invalid Zalo erasure interval");
        const scope = grant(grantId);
        if (!scope) return 0;
        db.prepare("INSERT OR IGNORE INTO zalo_erased_ranges VALUES(?,?,?,?)").run(grantId, start, end, end + scope.retentionDays * DAY);
        return Number(db.prepare("DELETE FROM zalo_events WHERE grantId=? AND timestamp BETWEEN ? AND ?").run(grantId, start, end).changes);
      });
    },
    accept(input: ZaloEvent, grantId: string, lease?: string): ZaloReceipt {
      const parsed = zaloEventInput.safeParse(input);
      if (!parsed.success) throw new Error("Invalid Zalo event");
      const e = parsed.data;
      return write(() => {
        const time = now();
        prune(time);
        const scope = grant(grantId);
        if (!scope || scope.adapter !== e.adapter || scope.accountId !== e.accountId || scope.conversationId !== e.conversationId ||
          scope.conversationType !== e.conversationType || scope.senderId !== e.senderId ||
          (scope.adapter === "official" && e.direction !== "incoming")) return "revoked";
        if (lease !== undefined && !db.prepare("SELECT 1 FROM zalo_poll_leases WHERE lease=? AND grantedTo=? AND until>?").get(lease, grantId, time)) return "revoked";
        const expires = e.timestamp + scope.retentionDays * DAY;
        if (e.timestamp < scope.since || expires <= time) return "expired";
        if (db.prepare("SELECT 1 FROM zalo_erased_ranges WHERE grantId=? AND ? BETWEEN start AND end").get(grantId, e.timestamp)) return "revoked";
        if (e.timestamp > time + 300_000) throw new Error("Invalid Zalo event time");
        const key = [e.adapter, e.accountId, e.conversationId, e.conversationType, e.messageId];
        const existing = db.prepare("SELECT grantId,timestamp,text,direction FROM zalo_events WHERE adapter=? AND accountId=? AND conversationId=? AND conversationType=? AND messageId=?").get(...key);
        if (existing) {
          return existing.grantId === grantId && existing.timestamp === e.timestamp && existing.text === e.text &&
            existing.direction === e.direction ? "duplicate" : "conflict";
        }
        db.prepare("INSERT INTO zalo_events(adapter,accountId,conversationId,conversationType,messageId,grantId,timestamp,text,direction,expires) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(...key, grantId, e.timestamp, e.text, e.direction, expires);
        return "persisted";
      });
    },
    read(grantId: string, limit = 100, after?: { timestamp: number; messageId: string }): ZaloEvent[] {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid Zalo page size");
      return write(() => {
        prune(now());
        return db.prepare(`SELECT e.adapter,e.accountId,e.conversationId,g.conversationType,e.messageId,g.senderId,e.timestamp,e.text,e.direction
          FROM zalo_events e JOIN zalo_grants g USING(grantId)
          WHERE e.grantId=? AND (e.timestamp,e.messageId)>(?,?) ORDER BY e.timestamp,e.messageId LIMIT ?`)
          .all(grantId, after?.timestamp ?? 0, after?.messageId ?? "", limit) as unknown as ZaloEvent[];
      });
    },
    coverage(grantId: string) {
      return write(() => {
        prune(now());
        const scope = grant(grantId);
        if (!scope) return undefined;
        const observed = db.prepare("SELECT COUNT(*) AS count,MIN(timestamp) AS first,MAX(timestamp) AS last FROM zalo_events WHERE grantId=?")
          .get(grantId) as { count: number; first: number | null; last: number | null };
        const recentGaps = db.prepare("SELECT start,end FROM zalo_poll_gaps WHERE grantId=? ORDER BY end DESC LIMIT 50").all(grantId);
        const webhookTiming = db.prepare("SELECT reason,observed FROM zalo_webhook_time_gaps WHERE grantId=? ORDER BY observed DESC,reason").all(grantId);
        return { ...observed, ...(webhookTiming.length ? { webhookTiming } : {}), lastPoll: scope.lastPoll, recentGaps, completeHistory: false as const };
      });
    },
    beginOfficialPoll(grantId: string) {
      return write(() => {
        const time = now();
        prune(time);
        const scope = grant(grantId);
        if (scope?.adapter !== "official" || db.prepare("SELECT 1 FROM zalo_webhook_endpoints WHERE accountId=?").get(scope.accountId)) return undefined;
        const existing = db.prepare("SELECT until FROM zalo_poll_leases WHERE accountId=?").get(scope.accountId);
        if (existing && Number(existing.until) > time) return undefined;
        gap(scope, scope.lastPoll ?? scope.since, time);
        const lease = randomUUID();
        // The lease outlasts the two five-second probes and the 35-second poll.
        db.prepare("INSERT OR REPLACE INTO zalo_poll_leases(accountId,lease,grantedTo,started,until) VALUES(?,?,?,?,?)")
          .run(scope.accountId, lease, grantId, time, time + 60_000);
        return lease;
      });
    },
    finishOfficialPoll(lease: string, observed: boolean) {
      write(() => {
        const time = now();
        const held = db.prepare("SELECT grantedTo,started,until FROM zalo_poll_leases WHERE lease=?").get(lease);
        if (!held) return;
        const scope = grant(String(held.grantedTo));
        if (scope) {
          if (!observed || Number(held.until) <= time) gap(scope, Number(held.started), time);
          else db.prepare("UPDATE zalo_grants SET lastPoll=? WHERE grantId=?").run(time, scope.grantId);
        }
        db.prepare("DELETE FROM zalo_poll_leases WHERE lease=?").run(lease);
      });
    },
    purgeExpired() {
      write(() => {
        const time = now();
        prune(time);
        purgeExpiredZaloReportHistory(db, time);
      });
    },
  };
}
