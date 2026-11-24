import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AppTriggerTestReceipts } from "./app-trigger-test-receipts.ts";

it("persists an isolated one-use test receipt before exposing its marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-")), file = join(dir, "receipts.json");
  let now = 1_000;
  try {
    const identity = { actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" };
    const store = new AppTriggerTestReceipts(file, () => now);
    const eventId = `test_${randomUUID()}`;
    const first = store.reserve(identity);
    expect(first.created).toBe(true);
    expect(store.reserve(identity)).toEqual({ receipt: first.receipt, created: false });
    expect(() => store.reserve({ ...identity, triggerId: "other" })).toThrow();
    expect(() => store.reserve({ ...identity, actor: "other", requestKey: randomUUID() })).toThrow("pending");
    const reopened = new AppTriggerTestReceipts(file, () => now);
    expect(reopened.find("other", first.receipt.id)).toBeNull();
    const begun = reopened.begin("fixture-owner", first.receipt.id)!;
    expect(begun.token).toBeTruthy();
    expect(readFileSync(file, "utf8")).not.toContain(begun.token);
    expect(reopened.inspect(begun.token, "remote")).toMatchObject({ receipt: { state: "sending" }, binding: { actor: identity.actor, botId: identity.botId, triggerId: identity.triggerId, accountId: identity.accountId } });
    expect(reopened.find(identity.actor, first.receipt.id)?.state).toBe("sending");
    expect(reopened.begin("fixture-owner", first.receipt.id)).toBeNull();
    expect(reopened.claim(begun.token, "wrong-remote", eventId)).toBeNull();
    const claimed = reopened.claim(begun.token, "remote", eventId)!;
    expect(claimed).toMatchObject({ receipt: { id: first.receipt.id, state: "processing" }, eventId, fresh: true, sameEvent: true });
    expect(() => reopened.settle(first.receipt.id, "handled", "synthetic-run")).toThrow("not reached admission");
    expect(reopened.beginAdmission(claimed.permit!)).toBe(true);
    const recovered = new AppTriggerTestReceipts(file, () => now);
    expect(recovered.claim(begun.token, "remote", `test_${randomUUID()}`)).toMatchObject({ receipt: { id: first.receipt.id, state: "processing" }, eventId, fresh: false, sameEvent: false });
    expect(() => reopened.settle(first.receipt.id, "handled", "x".repeat(201))).toThrow();
    expect(reopened.find(identity.actor, first.receipt.id)?.state).toBe("processing");
    expect(reopened.settle(first.receipt.id, "handled", "synthetic-run")).toMatchObject({ state: "handled", runId: "synthetic-run" });
    expect(reopened.settle(first.receipt.id, "handled", "synthetic-run")).toMatchObject({ state: "handled", runId: "synthetic-run" });
    expect(() => reopened.settle(first.receipt.id, "handled", "different-run")).toThrow("conflicts");
    expect(reopened.claim(begun.token, "remote", eventId)).toMatchObject({ receipt: { id: first.receipt.id, state: "handled" }, eventId, fresh: false });
    now += 30 * 24 * 60 * 60_000;
    expect(reopened.reserve(identity)).toMatchObject({ created: false, receipt: { state: "handled", runId: "synthetic-run" } });
    const next = reopened.reserve({ ...identity, requestKey: randomUUID() });
    const pending = reopened.begin("fixture-owner", next.receipt.id)!;
    expect(() => reopened.settle(next.receipt.id, "cancelled")).toThrow("uncertain");
    now = next.receipt.reviewAfter + 1;
    const nextEvent = `test_${randomUUID()}`;
    expect(reopened.claim(pending.token, "remote", nextEvent)).toMatchObject({ receipt: { id: next.receipt.id }, fresh: true });
    expect(() => reopened.reserve({ ...identity, requestKey: randomUUID() })).toThrow("pending");
    now = 0;
    expect(reopened.claim(pending.token, "remote", nextEvent)).toMatchObject({ receipt: { id: next.receipt.id }, fresh: false });
    const journal = JSON.parse(readFileSync(file, "utf8"));
    journal.entries.push(journal.entries[0]);
    writeFileSync(file, JSON.stringify(journal));
    expect(() => new AppTriggerTestReceipts(file).reserve(identity)).toThrow("cannot be read");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("fails closed on invalid or unwritable storage", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-invalid-"));
  const identity = { actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" };
  try {
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{broken");
    expect(() => new AppTriggerTestReceipts(corrupt).reserve(identity)).toThrow("cannot be read");
    const notDirectory = join(dir, "not-directory");
    writeFileSync(notDirectory, "fixture");
    const blocked = new AppTriggerTestReceipts(join(notDirectory, "receipts.json"));
    expect(() => blocked.reserve(identity)).toThrow();
    expect(() => blocked.reserve(identity)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("does not follow a journal symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-link-"));
  try {
    const target = join(dir, "target.json"), link = join(dir, "journal.json");
    writeFileSync(target, JSON.stringify({ version: 1, entries: [] }));
    symlinkSync(target, link);
    const store = new AppTriggerTestReceipts(link);
    expect(() => store.reserve({ actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" })).toThrow("cannot be read");
    expect(JSON.parse(readFileSync(target, "utf8")).entries).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("keeps the old state when writing the sending or handled receipt fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-write-")), file = join(dir, "receipts.json");
  const identity = { actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" };
  try {
    const store = new AppTriggerTestReceipts(file);
    const reserved = store.reserve(identity).receipt;
    const old = readFileSync(file);
    rmSync(file); mkdirSync(file);
    expect(() => store.begin(identity.actor, reserved.id)).toThrow();
    expect(store.find(identity.actor, reserved.id)?.state).toBe("reserved");
    rmSync(file, { recursive: true }); writeFileSync(file, old);
    const sending = store.begin(identity.actor, reserved.id)!;
    const eventId = `test_${randomUUID()}`;
    const beforeClaim = readFileSync(file);
    rmSync(file); mkdirSync(file);
    expect(() => store.claim(sending.token, "remote", eventId)).toThrow();
    expect(store.find(identity.actor, reserved.id)?.state).toBe("sending");
    rmSync(file, { recursive: true }); writeFileSync(file, beforeClaim);
    const claimed = store.claim(sending.token, "remote", eventId)!;
    expect(claimed.fresh).toBe(true);
    expect(store.beginAdmission(claimed.permit!)).toBe(true);
    const sent = readFileSync(file);
    rmSync(file); mkdirSync(file);
    expect(() => store.settle(reserved.id, "handled", "run")).toThrow();
    expect(store.claim(sending.token, "remote", eventId)).toMatchObject({ receipt: { id: reserved.id }, fresh: false });
    rmSync(file, { recursive: true }); writeFileSync(file, sent);
    expect(store.settle(reserved.id, "handled", "run")?.state).toBe("handled");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("does not start a canceled late test or let two operations claim one event ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-claim-"));
  try {
    const store = new AppTriggerTestReceipts(join(dir, "journal.json"));
    const make = (triggerId: string) => ({ actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId, remoteId: "remote", accountId: "account" });
    const first = store.reserve(make("first")).receipt, firstToken = store.begin("fixture-owner", first.id)!.token;
    expect(store.cancelUnclaimed("another-actor", first.id)).toBeNull();
    expect(store.cancelUnclaimed("fixture-owner", first.id)?.state).toBe("cancelled");
    const next = store.reserve(make("first")).receipt, nextToken = store.begin("fixture-owner", next.id)!.token;
    const other = store.reserve(make("other")).receipt, otherToken = store.begin("fixture-owner", other.id)!.token;
    const recovered = new AppTriggerTestReceipts(join(dir, "journal.json"));
    expect(recovered.claim(firstToken, "remote", `test_${randomUUID()}`)).toMatchObject({ fresh: false, receipt: { state: "cancelled" } });
    const eventId = `test_${randomUUID()}`;
    expect(recovered.claim(nextToken, "remote", eventId)?.fresh).toBe(true);
    expect(() => recovered.claim(otherToken, "remote", eventId)).toThrow();
    expect(recovered.find("fixture-owner", other.id)?.state).toBe("sending");
    expect(recovered.cancelUnclaimed("fixture-owner", next.id)).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("only lets the fresh event claim record a no-effect outcome before admission", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-admit-"));
  try {
    const store = new AppTriggerTestReceipts(join(dir, "journal.json"));
    const make = (triggerId: string) => ({ actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId, remoteId: "remote", accountId: "account" });
    const first = store.reserve(make("first")).receipt, token = store.begin("fixture-owner", first.id)!.token, event = `test_${randomUUID()}`;
    const claim = store.claim(token, "remote", event)!;
    expect(store.rejectBeforeAdmission({}, "filtered")).toBeNull();
    expect(store.rejectBeforeAdmission(claim.permit!, "filtered")).toMatchObject({ state: "rejected", reason: "filtered" });
    expect(store.beginAdmission(claim.permit!)).toBe(false);
    expect(store.claim(token, "remote", event)).toMatchObject({ fresh: false, receipt: { state: "rejected", reason: "filtered" } });
    const next = store.reserve(make("first")).receipt, nextToken = store.begin("fixture-owner", next.id)!.token;
    const nextClaim = store.claim(nextToken, "remote", `test_${randomUUID()}`)!;
    expect(store.beginAdmission(nextClaim.permit!)).toBe(true);
    expect(store.beginAdmission(nextClaim.permit!)).toBe(false);
    expect(store.rejectBeforeAdmission(nextClaim.permit!, "paused")).toBeNull();
    expect(new AppTriggerTestReceipts(join(dir, "journal.json")).find("fixture-owner", next.id)?.state).toBe("processing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("retains the no-effect permit if persisting rejection fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-reject-")), file = join(dir, "journal.json");
  try {
    const store = new AppTriggerTestReceipts(file);
    const entry = store.reserve({ actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" }).receipt;
    const token = store.begin("fixture-owner", entry.id)!.token;
    const claimed = store.claim(token, "remote", `test_${randomUUID()}`)!;
    const old = readFileSync(file);
    rmSync(file); mkdirSync(file);
    expect(() => store.rejectBeforeAdmission(claimed.permit!, "filtered")).toThrow();
    expect(store.find("fixture-owner", entry.id)?.state).toBe("processing");
    rmSync(file, { recursive: true }); writeFileSync(file, old);
    expect(store.rejectBeforeAdmission(claimed.permit!, "filtered")).toMatchObject({ state: "rejected", reason: "filtered" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("keeps a sent request uncertain until an event arrives or it is cancelled", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-uncertain-"));
  try {
    const file = join(dir, "journal.json"), store = new AppTriggerTestReceipts(file);
    const identity = { actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" };
    const receipt = store.reserve(identity).receipt, begun = store.begin(identity.actor, receipt.id)!;
    const reopened = new AppTriggerTestReceipts(file, Date.now, { requireExisting: true });
    expect(reopened.find(identity.actor, receipt.id)?.state).toBe("sending");
    expect(reopened.begin(identity.actor, receipt.id)).toBeNull();
    expect(reopened.claim(begun.token, "remote", `test_${randomUUID()}`)?.fresh).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("fails closed when an established profile is missing its receipt journal", () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-receipts-missing-"));
  try {
    const file = join(dir, "journal.json");
    const missing = new AppTriggerTestReceipts(file, Date.now, { requireExisting: true });
    expect(() => missing.hasPending()).toThrow("cannot be read");
    expect(() => missing.reserve({ actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" })).toThrow("cannot be read");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
