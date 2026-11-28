import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { webhookClock } from "./zalo-webhook-clock.ts";
import { createZaloInbox } from "./zalo-inbox.ts";
import { zaloPeriodReports } from "./zalo-period-report.ts";

const scope = { adapter: "official" as const, accountId: "fixture", conversationType: "direct" as const, conversationId: "chat-a", senderId: "sender-a", retentionDays: 14 };
const daily = { cadence: "daily" as const, hour: 17, minute: 0, timeZone: "Asia/Ho_Chi_Minh" };

it("uses the routine timezone, produces one period through restart, and rechecks deletion, revocation and consent epoch on read and run", () => {
  const dir = mkdtempSync(join(tmpdir(), "zalo-report-")), file = join(dir, "private.sqlite");
  const db = new DatabaseSync(file), observer = new DatabaseSync(file);
  let time = Date.parse("2026-11-28T09:50:00Z");
  try {
    const inbox = createZaloInbox(db, () => time);
    const id = inbox.enroll(scope);
    db.prepare("INSERT INTO zalo_webhook_endpoints VALUES(?,?,?,?)").run("e", scope.accountId, Buffer.from("fixture"), id);
    const store = zaloPeriodReports(db, scope.accountId, () => time);
    const second = zaloPeriodReports(observer, scope.accountId, () => time);
    const before = store.view()!;
    const schedule = store.configure(before.revision, daily)!;
    expect(schedule.next).toBe(Date.parse("2026-11-28T10:00:00Z"));
    expect(store.configure(before.revision, null)).toBeUndefined();
    time += 1_000;
    const first = time;
    expect(inbox.accept({ ...scope, messageId: "a", timestamp: time, text: "Đối soát công nợ gấp", direction: "incoming" }, id)).toBe("persisted");
    time += 10;
    expect(inbox.accept({ ...scope, messageId: "b", timestamp: time, text: "Xin chào", direction: "incoming" }, id)).toBe("persisted");
    expect(second.view()!.periods).toEqual([]);
    time = schedule.next!;
    store.tick(); second.tick();
    expect(second.view()!.periods).toEqual([{ start: Date.parse("2026-11-28T09:50:00Z"), end: time, timeZone: daily.timeZone, count: 2, examined: 2, urgent: 1, gaps: 0 }]);
    inbox.eraseInterval(id, first, first);
    expect(second.view()!.periods[0]).toMatchObject({ count: 1, urgent: 0 });
    expect(second.configure(second.view()!.revision, null)!.periods).toEqual([]);
    expect(second.configure(before.revision, daily)).toBeUndefined();
    second.configure(second.view()!.revision, daily);
    inbox.revoke(id);
    time += 86_400_000;
    second.tick();
    expect(second.view()).toBeNull(); expect(second.next()).toBeNull();
    expect(db.prepare("SELECT count(*) n FROM zalo_period_schedule").get()?.n).toBe(0);
    const nextId = inbox.enroll(scope);
    db.prepare("UPDATE zalo_webhook_endpoints SET grantId=?").run(nextId);
    expect(second.view()).toMatchObject({ schedule: null, periods: [] });
    expect(second.configure(schedule.revision, daily)).toBeUndefined();
  } finally { db.close(); observer.close(); rmSync(dir, { recursive: true, force: true }); }
});
it("keeps hourly output local to the selected bot and labels bounded urgency samples and repeated clock passes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    let time = Date.parse("2026-11-28T09:00:01Z");
    const inbox = createZaloInbox(db, () => time), id = inbox.enroll(scope);
    db.prepare("INSERT INTO zalo_webhook_endpoints VALUES(?,?,?,?)").run("e", scope.accountId, Buffer.from("fixture"), id);
    const store = zaloPeriodReports(db, scope.accountId, () => time);
    store.configure(store.view()!.revision, { ...daily, cadence: "hourly" });
    for (let i = 0; i < 203; i++) {
      time += 1;
      inbox.accept({ ...scope, messageId: String(i), timestamp: time, text: "Xử lý gấp", direction: "incoming" }, id);
    }
    time = Date.parse("2026-11-28T11:00:00Z");
    store.tick(); store.tick();
    expect(store.view()!.periods.map(p => [p.count, p.examined, p.urgent])).toEqual([[0, 0, 0], [203, 200, 200]]);
    expect(zaloPeriodReports(db, "other", () => time).view()).toBeNull();
  } finally { db.close(); }
});

it("retains each completed period's timing warning when the same source warning recurs next period", () => {
  const db = new DatabaseSync(":memory:");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_LOCAL_REPORTS", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "0");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", scope.accountId);
  try {
    let time = Date.parse("2026-11-28T08:05:00Z");
    const inbox = createZaloInbox(db, () => time), id = inbox.enroll(scope);
    db.prepare("INSERT INTO zalo_webhook_endpoints VALUES(?,?,?,?)").run("e", scope.accountId, Buffer.from("fixture"), id);
    const store = zaloPeriodReports(db, scope.accountId, () => time), clock = webhookClock(db);
    store.configure(store.view()!.revision, { ...daily, cadence: "hourly" });
    const warn = () => clock.assess("e", "fixture-secret", { ...scope, direction: "incoming", messageId: String(time),
      text: "Fixture", timestamp: time + 10 * 60_000 }, inbox.grant(id), id, time);
    const retained = () => db.prepare("SELECT COUNT(*) n FROM zalo_period_timing").get()!.n;
    time += 1; expect(warn()).toBe(503); expect(retained()).toBe(0);
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "different-bot");
    time += 1; expect(warn()).toBe(503); expect(retained()).toBe(0);
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", scope.accountId);
    time += 12_000; expect(warn()).toBe(503); expect(retained()).toBe(1);
    time = Date.parse("2026-11-28T09:00:00Z"); store.tick();
    expect(store.view()!.periods[0]!.gaps).toBe(1);
    time += 60_000; expect(warn()).toBe(503);
    time = Date.parse("2026-11-28T10:00:00Z"); store.tick();
    expect(store.view()!.periods.map(p => p.gaps)).toEqual([1, 1]);
    inbox.revoke(id);
    expect(db.prepare("SELECT COUNT(*) n FROM zalo_period_timing").get()!.n).toBe(0);
  } finally { db.close(); vi.unstubAllEnvs(); }
});
