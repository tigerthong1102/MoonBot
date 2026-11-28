import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createZaloInbox } from "./zalo-inbox.ts";
import { attachZaloRetention } from "./zalo-retention.ts";

const DAY = 86_400_000;
let home: string;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-28T09:00:00Z"));
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1"); vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  home = mkdtempSync(join(tmpdir(), "zalo-idle-"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

it("purges expired rows on startup and on an idle timer without reads, ingress or UI, until the server closes", () => {
  const dir = join(home, ".startupbot-qualification", "zalo-official");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "inbox.sqlite"), db = new DatabaseSync(file); chmodSync(file, 0o600);
  const server = createServer();
  try {
    const now = Date.now(), enrolled = now - DAY - 1000;
    let clock = enrolled;
    const inbox = createZaloInbox(db, () => clock);
    const scope = { adapter: "official", accountId: "fixture", conversationId: "chat", conversationType: "direct", senderId: "person" } as const;
    const grant = inbox.enroll({ ...scope, retentionDays: 1 });
    for (const [i, offset] of [0, 61_000, 301_001].entries()) {
      clock = enrolled + offset;
      expect(inbox.accept({ ...scope, messageId: String(i), timestamp: clock, text: "synthetic", direction: "incoming" }, grant)).toBe("persisted");
    }
    const count = () => db.prepare("SELECT COUNT(*) AS n FROM zalo_events").get()!.n;
    attachZaloRetention(server, true, () => home);
    expect(count()).toBe(3);
    server.emit("listening");
    expect(count()).toBe(2);
    vi.advanceTimersByTime(5 * 60_000);
    expect(count()).toBe(1);
    server.emit("close");
    vi.advanceTimersByTime(5 * 60_000);
    expect(count()).toBe(1);
  } finally { db.close(); }
});

it("does not schedule work on a remote host or disabled pilot and never creates a missing inbox", () => {
  const server = createServer(), getHome = vi.fn(() => home);
  const initialListeners = server.listenerCount("listening");
  attachZaloRetention(server, false, getHome);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "0");
  attachZaloRetention(server, true, getHome);
  expect(server.listenerCount("listening")).toBe(initialListeners);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  attachZaloRetention(server, true, getHome);
  server.emit("listening");
  expect(getHome).toHaveBeenCalledOnce();
  expect(existsSync(join(home, ".startupbot-qualification"))).toBe(false);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "0");
  vi.advanceTimersByTime(10 * 60_000);
  expect(getHome).toHaveBeenCalledOnce();
  server.emit("close");
});
