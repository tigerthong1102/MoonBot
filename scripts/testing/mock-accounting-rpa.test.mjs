import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { mockGrant, mockScope, openAccountingFixture, workflow } from "./mock-accounting-rpa.mjs";

function voucher(id, details = {}) {
  return {
    company: "DEMO-A", fiscalYear: "2026", period: "2026-11", date: "19/11/2026",
    currency: "VND", voucherId: id, lines: [
      { account: "1111", party: "0001", side: "debit", amount: "100000" },
      { account: "131", party: "0001", side: "credit", amount: "100000" },
    ], ...details,
  };
}

function input(draft, changes = {}) {
  const scope = mockScope(draft.company);
  return { candidate: workflow, voucher: draft, scope, readGrant: () => mockGrant(scope), approve: (binding) => binding, ...changes };
}

function setup(t) {
  const fixture = openAccountingFixture();
  t.onTestFinished(() => fixture.dispose());
  return { fixture, runtime: fixture.connect() };
}

// This file-backed corpus performs thousands of durable SQLite writes. Hosted Windows has taken 226s for all 10,000 cases.
test("10,000-case synthetic corpus verifies every accepted draft and rejects known bad outcomes", { timeout: process.platform === "win32" ? 360_000 : 60_000 }, async (t) => {
  const { runtime } = setup(t);
  const totals = { VERIFIED: 0, UNKNOWN: 0, FAILED: 0, BLOCKED: 0 };
  let attempts = 0;
  let interventionCount = 0;
  for (let i = 0; i < 10_000; i++) {
    const testCase = i % 20;
    const draft = voucher("V-" + i, { company: i % 2 ? "DEMO-A" : "DEMO-B" });
    const instance = input(draft);
    let expected = "VERIFIED";
    switch (testCase) {
      case 0:
        draft.lines[1].amount = "99999";
        expected = "BLOCKED";
        break;
      case 1:
        draft.lines[0].account = "9999";
        expected = "BLOCKED";
        break;
      case 2:
        draft.date = "31/10/2026";
        draft.period = "2026-10";
        expected = "BLOCKED";
        break;
      case 3:
        draft.lines[0].party = "1";
        expected = "BLOCKED";
        break;
      case 4:
        instance.fault = "wrong-party";
        expected = "FAILED";
        break;
      case 5:
        instance.fault = "no-effect";
        expected = "UNKNOWN";
        break;
      case 6:
        instance.fault = "before-write-disconnect";
        expected = "UNKNOWN";
        break;
      case 7:
        instance.fault = "response-lost";
        break;
      case 8:
        draft.currency = "USD";
        draft.lines[0].amount = "9007199254740993.01";
        draft.lines[1].amount = "9007199254740993.01";
        draft.lines[1].party = "0002";
        break;
      case 9:
        runtime.addExistingDraft(draft);
        expected = "BLOCKED";
        break;
      default:
        break;
    }
    const result = await runtime.run(instance);
    assert.equal(result.status, expected, "fixture case " + i);
    assert.deepEqual([result.aiCalls, result.inputTokens, result.outputTokens, result.cuaCalls], [0, 0, 0, 0]);
    assert.equal(result.writeAttempts, expected === "BLOCKED" ? 0 : 1);
    attempts += result.writeAttempts;
    interventionCount += result.interventions;
    totals[result.status]++;
  }
  assert.deepEqual(totals, { VERIFIED: 6000, UNKNOWN: 1000, FAILED: 500, BLOCKED: 2500 });
  assert.equal(runtime.count(), 7000);
  assert.equal(attempts, 7500);
  assert.equal(interventionCount, 7500);
  console.info(JSON.stringify({ cases: 10_000, totals, persisted: runtime.count(), attempts, interventionCount, aiCalls: 0, inputTokens: 0, outputTokens: 0, cuaCalls: 0 }));
});

test("validation uses exact money and calendar rules", async (t) => {
  const { runtime } = setup(t);
  for (const [mod, reason] of [
    [(draft) => { draft.date = "31/11/2026"; }, "bad-company-or-period"],
    [(draft) => { draft.date = "11/19/2026"; }, "bad-company-or-period"],
    [(draft) => { draft.lines[0].amount = "100000.01"; }, "bad-side-or-amount"],
    [(draft) => { draft.lines[0].amount = 100000; }, "bad-side-or-amount"],
    [(draft) => { draft.lines[0].side = "other"; }, "bad-side-or-amount"],
    [(draft) => { draft.voucherId = "../x"; }, "bad-id"],
  ]) {
    const draft = voucher("invalid");
    mod(draft);
    assert.equal((await runtime.run(input(draft))).reason, reason);
  }
  const usd = voucher("usd", { currency: "USD" });
  usd.lines[0].amount = "9007199254740993.01";
  usd.lines[1].amount = "9007199254740993.02";
  assert.equal((await runtime.run(input(usd))).reason, "unbalanced");
  assert.equal(runtime.count(), 0);
});

test("invalid scope, digest, expiry, denial, revocation and Stop never dispatch", async (t) => {
  const { runtime } = setup(t);
  const draft = voucher("blocked");
  const scope = mockScope();
  const other = mockScope("DEMO-B");
  const c = new AbortController();
  let revoked = false;
  for (const [changes, reason] of [
    [{ candidate: { ...workflow, steps: ["post-ledger"] } }, "workflow-untrusted"],
    [{ scope: other }, "permission"],
    [{ readGrant: () => ({ ...mockGrant(scope), permission: "accounting.post" }) }, "permission"],
    [{ readGrant: () => mockGrant(scope, 0) }, "permission"],
    [{ approve: () => "digest-for-another-action" }, "approval-required"],
    [{ readGrant: () => ({ ...mockGrant(scope), revoked }), approve: (binding) => { revoked = true; return binding; } }, "permission"],
    [{ signal: c.signal, approve: (binding) => { c.abort(); return binding; } }, "stopped"],
  ]) {
    const result = await runtime.run(input(draft, changes));
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, reason);
    assert.equal(result.writeAttempts, 0);
  }
  assert.equal(runtime.count(), 0);
});

test("concurrent sessions and two companies preserve unique scoped draft identity", async (t) => {
  const { fixture, runtime } = setup(t);
  const second = fixture.connect();
  const draft = voucher("same-id");
  const responses = await Promise.all([
    runtime.run(input(draft)),
    second.run(input(draft)),
    second.run(input(voucher("same-id", { company: "DEMO-B" }))),
  ]);
  assert.ok(responses.every((entry) => entry.status === "VERIFIED"));
  assert.deepEqual(responses.map((entry) => entry.writeAttempts), [1, 0, 1]);
  assert.equal(runtime.count(), 2);
  const changed = voucher("same-id");
  changed.lines[0].party = "0002";
  assert.equal((await second.run(input(changed))).reason, "idempotency-conflict");
  assert.equal(runtime.count(), 2);
});

test("restart after ambiguous writes uses read-back only and preserves UNKNOWN", async (t) => {
  const { fixture, runtime } = setup(t);
  const draft = voucher("saved-without-confirmation");
  const missing = voucher("crashed-before-effect");
  const uncertain = await runtime.run(input(draft, { fault: "readback-unavailable" }));
  const disconnected = await runtime.run(input(missing, { fault: "before-write-disconnect" }));
  assert.equal(uncertain.status, "UNKNOWN");
  assert.equal(disconnected.status, "UNKNOWN");
  assert.equal(runtime.count(), 1);
  runtime.close();

  const reopened = fixture.connect();
  const recovered = await reopened.run(input(draft, { approve: () => assert.fail("recovery cannot dispatch") }));
  const unresolved = await reopened.run(input(missing, { approve: () => assert.fail("recovery cannot dispatch") }));
  assert.equal(recovered.status, "VERIFIED");
  assert.equal(unresolved.status, "UNKNOWN");
  assert.deepEqual([recovered.writeAttempts, unresolved.writeAttempts, reopened.count()], [0, 0, 1]);
});

test("Stop settles an unanswered approval and a late approval cannot write", async (t) => {
  const { runtime } = setup(t);
  const controller = new AbortController();
  let approveLate;
  const result = runtime.run(input(voucher("cancel-pending"), {
    signal: controller.signal,
    approve: (binding) => new Promise((resolve) => { approveLate = () => resolve(binding); }),
  }));
  await Promise.resolve();
  assert.equal(typeof approveLate, "function");
  controller.abort();
  assert.equal((await result).reason, "stopped");
  approveLate();
  assert.equal(runtime.count(), 0);
});

test("an unanswered approval expires without dispatch", async (t) => {
  const { runtime } = setup(t);
  vi.useFakeTimers();
  try {
    const result = runtime.run(input(voucher("approval-timeout"), { approve: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(30_000);
    const outcome = await result;
    assert.equal(outcome.status, "BLOCKED");
    assert.equal(outcome.reason, "approval-timeout");
    assert.equal(outcome.writeAttempts, 0);
    assert.equal(runtime.count(), 0);
  } finally {
    vi.useRealTimers();
  }
});

test("revocation after reservation blocks dispatch and leaves read-only recovery", async (t) => {
  const { runtime } = setup(t);
  const draft = voucher("revoked-at-dispatch");
  const scope = mockScope();
  let checks = 0;
  const revoked = await runtime.run(input(draft, {
    readGrant: () => ({ ...mockGrant(scope), revoked: ++checks >= 3 }),
  }));
  assert.equal(revoked.reason, "permission");
  assert.equal(revoked.writeAttempts, 0);
  const later = await runtime.run(input(draft, { approve: () => assert.fail("recovery cannot dispatch") }));
  assert.equal(later.status, "UNKNOWN");
  assert.deepEqual([later.writeAttempts, runtime.count()], [0, 0]);
});
