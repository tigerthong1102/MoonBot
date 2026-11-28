import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ZaloEvent } from "../shared/zalo-event.ts";
import { createZaloInbox } from "./zalo-inbox.ts";
import { createZaloOfficialReader, receiveOfficialIntoInbox } from "./zalo-official.ts";

const day = 86_400_000;
const start = 1_780_000_000_000;
const scope = { adapter: "official", accountId: "123", senderId: "private-abc", conversationId: "chat-abc", conversationType: "direct", retentionDays: 1 } as const;
const event: ZaloEvent = { adapter: scope.adapter, accountId: scope.accountId, senderId: scope.senderId, conversationId: scope.conversationId,
  conversationType: scope.conversationType, timestamp: start, messageId: "message-001", text: "Gửi báo giá trước 15 giờ nhé", direction: "incoming" };
let dir: string;
let time: number;
let handles: DatabaseSync[];
function open() {
  const db = new DatabaseSync(join(dir, "fixture.sqlite"));
  handles.push(db);
  return createZaloInbox(db, () => time);
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "zalo-inbox-")); time = start; handles = []; });
afterEach(() => { for (const db of handles) db.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const ok = (result: unknown) => Response.json({ ok: true, result });
const update = () => ok({ event_name: "message.text.received", message: {
  message_id: event.messageId, from: { id: scope.senderId, is_bot: false }, chat: { id: scope.conversationId, chat_type: "PRIVATE" },
  text: event.text, date: event.timestamp,
} });

it("commits an official text, recognizes replay after reopening, and isolates the same ID on another account", async () => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  const first = open();
  const grant = first.enroll(scope);
  const replies = [() => ok({ id: scope.accountId }), () => ok({ url: "" }), update];
  let calls = 0;
  const reader = createZaloOfficialReader(scope.accountId, "123:synthetic", async () => replies[calls++ % 3]());
  expect(await receiveOfficialIntoInbox(reader, first, grant)).toBe("persisted");
  handles.pop()!.close();
  const second = open();
  time += 5000;
  expect(await receiveOfficialIntoInbox(reader, second, grant)).toBe("duplicate");
  expect(second.read(grant)).toEqual([event]);
  expect(second.coverage(grant)).toEqual({ count: 1, first: start, last: start, lastPoll: time,
    recentGaps: [{ start, end: time }], completeHistory: false });
  const other = second.enroll({ ...scope, accountId: "another" });
  expect(second.accept({ ...event, accountId: "another", timestamp: time, text: "other" }, other)).toBe("persisted");
  expect(second.read(grant)[0].text).toBe(event.text);
  expect(second.read(other)[0].text).toBe("other");
});

it("detects divergent replay and refuses a stale or mismatched enrollment on a second database connection", () => {
  const a = open(), b = open();
  const grant = a.enroll(scope);
  expect(() => b.enroll({ ...scope, senderId: "other" })).toThrow();
  expect(a.accept(event, grant)).toBe("persisted");
  expect(b.accept({ ...event, text: "different" }, grant)).toBe("conflict");
  for (const patch of [{ accountId: "other" }, { conversationId: "other" }, { senderId: "other" }, { adapter: "personal" as const },
    { conversationType: "group" as const }, { direction: "outgoing" as const }]) {
    expect(b.accept({ ...event, ...patch }, grant)).toBe("revoked");
  }
  expect(b.revoke(grant)).toBe(true);
  expect(a.read(grant)).toEqual([]);
  expect(a.coverage(grant)).toBeUndefined();
  time++;
  const next = b.enroll(scope);
  expect(a.accept(event, grant)).toBe("revoked");
  expect(a.accept(event, next)).toBe("expired");
});

it("bounds retention, orders equal timestamps, and paginates without repeating the boundary", () => {
  const inbox = open(), g = inbox.enroll(scope);
  for (const messageId of ["b", "a"]) expect(inbox.accept({ ...event, messageId }, g)).toBe("persisted");
  const [first] = inbox.read(g, 1);
  expect(first.messageId).toBe("a");
  expect(inbox.read(g, 1, first)[0].messageId).toBe("b");
  time += day;
  expect(inbox.read(g)).toEqual([]);
  expect(inbox.accept(event, g)).toBe("expired");
  expect(inbox.coverage(g)?.count).toBe(0);
});

it("fences revoked and expired polls across runtime connections; an offline interval remains visible", () => {
  const a = open(), b = open(), g = a.enroll(scope);
  const abandoned = a.beginOfficialPoll(g)!;
  expect(b.beginOfficialPoll(g)).toBeUndefined();
  time += 60_001;
  const actual = b.beginOfficialPoll(g)!;
  expect(actual).toBeTruthy();
  expect(a.accept(event, g, abandoned)).toBe("revoked");
  a.finishOfficialPoll(abandoned, true);
  expect(b.accept(event, g, actual)).toBe("persisted");
  b.finishOfficialPoll(actual, true);
  expect(a.coverage(g)?.recentGaps).toEqual([{ start, end: time }]);

  const revoked = b.beginOfficialPoll(g)!;
  a.revoke(g);
  const newGrant = a.enroll(scope);
  expect(a.beginOfficialPoll(newGrant)).toBeUndefined();
  b.finishOfficialPoll(revoked, false);
  expect(a.beginOfficialPoll(newGrant)).toBeTruthy();
});

it("rejects reenrollment while an Official provider request is pending in a different runtime", async () => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  const a = open(), b = open(), g = a.enroll(scope);
  let c = 0;
  const reader = createZaloOfficialReader(scope.accountId, "123:synthetic", async () => {
    c++;
    if (c === 1) return ok({ id: scope.accountId });
    if (c === 2) return ok({ url: "" });
    b.revoke(g);
    b.enroll(scope);
    return update();
  });
  expect(await receiveOfficialIntoInbox(reader, a, g)).toBe("revoked");
  expect(a.read(g)).toEqual([]);
});

it("separates group and private conversations whose provider identifiers coincide", () => {
  const inbox = open();
  for (const conversationType of ["direct", "group"] as const) {
    const g = inbox.enroll({ ...scope, adapter: "personal", conversationType });
    const input = { ...event, adapter: "personal" as const, conversationType, text: conversationType };
    expect(inbox.accept(input, g)).toBe("persisted");
    expect(inbox.read(g)).toEqual([input]);
  }
});

it("erases a time range and prevents redelivery from resurrecting it, then limits bulk revocation to the requested source", () => {
  const inbox = open(), a = inbox.enroll(scope);
  const b = inbox.enroll({ ...scope, adapter: "personal" });
  const c = inbox.enroll({ ...scope, adapter: "personal", accountId: "other" });
  expect(inbox.accept(event, a)).toBe("persisted");
  expect(inbox.eraseInterval(a, start - 1, start)).toBe(1);
  expect(inbox.accept(event, a)).toBe("revoked");
  time++;
  expect(inbox.accept({ ...event, timestamp: time, messageId: "fresh" }, a)).toBe("persisted");
  expect(inbox.revokeConversation(scope)).toBe(1);
  expect(inbox.read(a)).toEqual([]);
  expect(inbox.grant(b)).toBeDefined();
  expect(inbox.revokeAccount("personal", scope.accountId)).toBe(1);
  expect(inbox.grant(b)).toBeUndefined();
  expect(inbox.grant(c)).toBeDefined();
});
