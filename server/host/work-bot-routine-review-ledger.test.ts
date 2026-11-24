import { expect, it } from "vitest";
import { WorkBotRoutineReviewLedger, type WorkBotRoutineReviewIdentity } from "./work-bot-routine-review-ledger.ts";

const identity: WorkBotRoutineReviewIdentity = { requestId: "request", messageId: "message", botId: "bot", threadId: "thread", actorKey: "desktop-owner", authorityFingerprint: "c".repeat(64), operationFingerprint: "a".repeat(64), conflictFingerprint: "b".repeat(64) };

it("binds an in-memory permit to one exact review and consumes it once", () => {
  const ledger = new WorkBotRoutineReviewLedger();
  expect(() => ledger.register({ ...identity, operationFingerprint: "short" })).toThrow();
  expect(() => ledger.register({ requestId: "missing" } as WorkBotRoutineReviewIdentity)).toThrow();
  ledger.register(identity);
  expect(() => ledger.register(identity)).toThrow();
  for (const key of Object.keys(identity) as Array<keyof WorkBotRoutineReviewIdentity>) {
    expect(ledger.authorize({ ...identity, [key]: "different" })).toBeNull();
  }
  expect(ledger.consume({}, identity)).toBe(false);
  const permit = ledger.authorize(identity)!;
  expect(ledger.consume(permit, { ...identity, conflictFingerprint: "changed" })).toBe(false);
  expect(ledger.consume(permit, identity)).toBe(false);
  const fresh = ledger.authorize(identity)!;
  const duplicate = ledger.authorize(identity)!;
  expect(ledger.consume(fresh, identity)).toBe(true);
  expect(ledger.consume(duplicate, identity)).toBe(false);
  expect(ledger.consume(fresh, identity)).toBe(false);
  expect(ledger.authorize(identity)).toBeNull();
});

it("does not revive pending authorization after discard or process restart", () => {
  const ledger = new WorkBotRoutineReviewLedger();
  ledger.register(identity);
  const permit = ledger.authorize(identity)!;
  ledger.discard(identity.requestId);
  expect(ledger.consume(permit, identity)).toBe(false);
  expect(new WorkBotRoutineReviewLedger().authorize(identity)).toBeNull();
});

it("refuses an expired permit or a different actor or authority", () => {
  let now = 10;
  const ledger = new WorkBotRoutineReviewLedger(() => now, 20);
  ledger.register(identity);
  expect(ledger.authorize({ ...identity, actorKey: "another" })).toBeNull();
  expect(ledger.authorize({ ...identity, authorityFingerprint: "d".repeat(64) })).toBeNull();
  const permit = ledger.authorize(identity)!;
  now = 30;
  expect(ledger.consume(permit, identity)).toBe(false);
  expect(ledger.authorize(identity)).toBeNull();
});

it("removes expired entries before accepting a fresh review", () => {
  let now = 1;
  const ledger = new WorkBotRoutineReviewLedger(() => now, 10);
  ledger.register(identity);
  const old = ledger.authorize(identity)!;
  now = 11;
  ledger.register(identity);
  expect(ledger.consume(old, identity)).toBe(false);
  expect(ledger.consume(ledger.authorize(identity)!, identity)).toBe(true);
});
