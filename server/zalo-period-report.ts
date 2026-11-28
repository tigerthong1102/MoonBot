import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { classifyZaloText } from "../shared/zalo-intelligence.ts";
import type { ZaloPeriodView, ZaloReportSchedule } from "../shared/zalo-period-report.ts";
import { nextOccurrence } from "./routine-schedules.ts";
import { zaloWrite } from "./zalo-write.ts";

const DAY = 86_400_000;
const sampleLimit = 200;
const catchUpLimit = 12;
interface Grant { grantId: string; conversationId: string; senderId: string; since: number; retentionDays: number }
interface Timing extends ZaloReportSchedule { start: number; due: number }

function after(schedule: ZaloReportSchedule, time: number) {
  const hour = schedule.cadence === "daily" ? schedule.hour : "*";
  const next = nextOccurrence({ type: "cron", expression: `${schedule.minute} ${hour} * * *`, timeZone: schedule.timeZone }, time);
  if (next === null) throw Error("unschedulable");
  return next;
}

export function recordZaloReportTiming(db: DatabaseSync, grantId: string, reason: string, observed: number, expires: number) {
  if (process.env.STARTUPBOT_ZALO_LOCAL_REPORTS !== "1" || !db.prepare("SELECT 1 FROM sqlite_schema WHERE name='zalo_period_timing'").get()) return;
  const schedule = db.prepare("SELECT cadence,hour,minute,timeZone,start FROM zalo_period_schedule WHERE grantId=?").get(grantId) as unknown as Timing | undefined;
  if (!schedule || observed < schedule.start) return;
  db.prepare(`INSERT INTO zalo_period_timing VALUES(?,?,?,?,?) ON CONFLICT(grantId,end,reason)
    DO UPDATE SET observed=MAX(observed,excluded.observed),expires=MAX(expires,excluded.expires)`)
    .run(grantId, after(schedule, observed), reason, observed, expires);
}

export function zaloPeriodReports(db: DatabaseSync, accountId: string, now: () => number = Date.now) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS zalo_period_epoch(grantId TEXT PRIMARY KEY REFERENCES zalo_grants ON DELETE CASCADE, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS zalo_period_schedule(
      grantId TEXT PRIMARY KEY REFERENCES zalo_grants ON DELETE CASCADE,
      cadence TEXT NOT NULL, hour INTEGER NOT NULL, minute INTEGER NOT NULL, timeZone TEXT NOT NULL,
      start INTEGER NOT NULL, due INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS zalo_period_timing(
      grantId TEXT NOT NULL REFERENCES zalo_grants ON DELETE CASCADE, end INTEGER NOT NULL, reason TEXT NOT NULL,
      observed INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(grantId,end,reason));
    CREATE TABLE IF NOT EXISTS zalo_period_receipts(
      grantId TEXT NOT NULL REFERENCES zalo_grants ON DELETE CASCADE, start INTEGER NOT NULL, end INTEGER NOT NULL, timeZone TEXT NOT NULL,
      PRIMARY KEY(grantId,end));`);
  const current = () => db.prepare(`SELECT g.grantId,g.conversationId,g.senderId,g.since,g.retentionDays FROM zalo_grants g
    JOIN zalo_webhook_endpoints e ON e.grantId=g.grantId AND e.accountId=g.accountId
    WHERE g.adapter='official' AND g.conversationType='direct' AND e.accountId=?`).get(accountId) as unknown as Grant | undefined;
  const timing = (grantId: string) => db.prepare("SELECT cadence,hour,minute,timeZone,start,due FROM zalo_period_schedule WHERE grantId=?").get(grantId) as unknown as Timing | undefined;
  const revision = (g: Grant) => {
    const epoch = db.prepare("SELECT version FROM zalo_period_epoch WHERE grantId=?").get(g.grantId)?.version;
    return createHash("sha256").update(JSON.stringify([g.grantId, epoch])).digest("hex");
  };
  function view(): ZaloPeriodView | null {
    const grant = current();
    if (!grant) return null;
    const scheduled = timing(grant.grantId);
    const time = now();
    const cutoff = Math.max(grant.since, time - grant.retentionDays * DAY);
    db.prepare("DELETE FROM zalo_period_receipts WHERE grantId=? AND end<=?").run(grant.grantId, cutoff);
    db.prepare("DELETE FROM zalo_period_timing WHERE grantId=? AND expires<=?").run(grant.grantId, time);
    const windows = db.prepare("SELECT start,end,timeZone FROM zalo_period_receipts WHERE grantId=? ORDER BY end DESC LIMIT 5").all(grant.grantId) as unknown as Array<{ start: number; end: number; timeZone: string }>;
    const periods = windows.map(window => {
      const start = Math.max(window.start, cutoff), params = [grant.grantId, start, window.end, time] as const;
      const source = "FROM zalo_events WHERE grantId=? AND timestamp>=? AND timestamp<? AND expires>? AND direction='incoming'";
      const count = db.prepare("SELECT COUNT(*) AS n " + source).get(...params)!.n as number;
      const rows = db.prepare("SELECT text " + source + " ORDER BY timestamp,messageId LIMIT ?").all(...params, sampleLimit);
      const gaps = db.prepare(`SELECT (SELECT COUNT(*) FROM zalo_poll_gaps WHERE grantId=? AND start<? AND end>=?) +
        (SELECT COUNT(*) FROM (
          SELECT reason FROM zalo_period_timing WHERE grantId=? AND end=? AND observed>=? AND observed<? AND expires>?
          UNION SELECT reason FROM zalo_webhook_time_gaps WHERE grantId=? AND observed>=? AND observed<? AND expires>?)) AS n`)
        .get(grant.grantId, window.end, start, grant.grantId, window.end, start, window.end, time, grant.grantId, start, window.end, time)!.n as number;
      return { ...window, start, count, examined: rows.length, urgent: rows.filter(row => classifyZaloText(String(row.text)).urgent).length, gaps };
    });
    return { source: { accountId, conversationId: grant.conversationId, senderId: grant.senderId }, revision: revision(grant), schedule: scheduled ? { cadence: scheduled.cadence, hour: scheduled.hour, minute: scheduled.minute, timeZone: scheduled.timeZone } : null, next: scheduled?.due ?? null, periods };
  }
  return {
    view: () => zaloWrite(db, view),
    next: () => { const grant = current(); return grant ? timing(grant.grantId)?.due ?? null : null; },
    configure(expected: string, schedule: ZaloReportSchedule | null) {
      return zaloWrite(db, () => {
        const grant = current();
        if (!grant || revision(grant) !== expected) return undefined;
        db.prepare("INSERT OR REPLACE INTO zalo_period_epoch VALUES(?,?)").run(grant.grantId, randomUUID());
        db.prepare("DELETE FROM zalo_period_schedule WHERE grantId=?").run(grant.grantId);
        if (schedule) {
          const time = now();
          db.prepare("INSERT INTO zalo_period_schedule VALUES(?,?,?,?,?,?,?)")
            .run(grant.grantId, schedule.cadence, schedule.hour, schedule.minute, schedule.timeZone, time, after(schedule, time));
        } else {
          db.prepare("DELETE FROM zalo_period_receipts WHERE grantId=?").run(grant.grantId);
          db.prepare("DELETE FROM zalo_period_timing WHERE grantId=?").run(grant.grantId);
        }
        return view();
      });
    },
    tick() {
      return zaloWrite(db, () => {
        const grant = current(); if (!grant) return;
        const scheduled = timing(grant.grantId), time = now();
        if (!scheduled || scheduled.due > time) return;
        const cutoff = Math.max(grant.since, time - grant.retentionDays * DAY);
        let start = Math.max(scheduled.start, cutoff), due = scheduled.due;
        if (due <= start) due = after(scheduled, start);
        for (let count = 0; count < catchUpLimit && due <= time; count++) {
          db.prepare("INSERT OR IGNORE INTO zalo_period_receipts VALUES(?,?,?,?)").run(grant.grantId, start, due, scheduled.timeZone);
          start = due; due = after(scheduled, due);
        }
        db.prepare("DELETE FROM zalo_period_timing WHERE grantId=? AND expires<=?").run(grant.grantId, time);
        db.prepare("UPDATE zalo_period_schedule SET start=?,due=? WHERE grantId=?").run(start, due, grant.grantId);
        db.prepare("DELETE FROM zalo_period_receipts WHERE grantId=? AND end<=?").run(grant.grantId, cutoff);
      });
    },
  };
}
