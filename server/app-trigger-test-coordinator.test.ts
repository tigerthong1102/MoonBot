import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appTestEvent, createAppTriggerTestCoordinator } from "./app-trigger-test-coordinator.ts";
import { AppTriggerTestReceipts } from "./app-trigger-test-receipts.ts";
import { RoutineManager } from "./routines.ts";

it("accepts only the exact synthetic test envelope and removes its marker from event data", () => {
  const token = "synthetic-private-marker", data = { omb_test: true, note: "A test run started from StartupBot.", marker: token };
  const parsed = appTestEvent("test", "remote", `test_${randomUUID()}`, data)!;
  expect(parsed.token).toBe(token);
  expect(parsed.safeData).toEqual({ omb_test: true, note: "A test run started from StartupBot." });
  expect(JSON.stringify(parsed.safeData)).not.toContain(token);
  expect(appTestEvent("message", "remote", "event", data)).toBeNull();
  expect(appTestEvent("test", "remote", "event", { ...data, extra: token })).toBeNull();
});

it.each(["normal", "revoked", "fail-before", "fail-after"])("handles a synthetic test exactly once or remains uncertain (%s)", phase => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-coordinator-"));
  const journalFile = join(dir, "journal.json"), file = join(dir, "routines.json");
  const options = { file, botState: () => "busy" as const, createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0];
  let routines = new RoutineManager(options);
  try {
    let journal = new AppTriggerTestReceipts(journalFile);
    const identity = { actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" };
    const receipt = journal.reserve(identity).receipt, token = journal.begin(identity.actor, receipt.id)!.token;
    const event = { token, remoteId: identity.remoteId, eventId: `test_${randomUUID()}` };
    let attempts = 0;
    const coordinator = (current: AppTriggerTestReceipts, failure: string) => createAppTriggerTestCoordinator({
      receipts: current,
      validate: binding => binding.actor === identity.actor && binding.botId === identity.botId && binding.accountId === identity.accountId ? (phase === "revoked" ? "revoked" : null) : "revoked",
      admit: (binding, eventId) => {
        attempts++;
        if (failure === "fail-before") throw new Error("synthetic failure before enqueue");
        const result = routines.enqueueWebhook({ webhookId: binding.triggerId, webhookName: "Fixture", prompt: "Synthetic", botId: binding.botId, runOn: "maus", deliveryId: eventId, receivedAt: Date.now(), eventSource: "app", receiptScope: "app-test" });
        if (failure === "fail-after") throw new Error("synthetic failure after enqueue");
        return result;
      },
      proof: (binding, eventId) => routines.webhookRunReceipt(binding.triggerId, eventId, "app-test"),
    });
    if (phase.startsWith("fail")) expect(() => coordinator(journal, phase).receive(event)).toThrow("synthetic failure");
    else expect(coordinator(journal, "none").receive(event).state).toBe(phase === "revoked" ? "rejected" : "handled");
    routines.close();
    routines = new RoutineManager(options);
    journal = new AppTriggerTestReceipts(journalFile);
    const replay = coordinator(journal, "none").receive(event);
    expect(replay.state).toBe(phase === "revoked" ? "rejected" : phase === "fail-before" ? "unknown" : "handled");
    expect(attempts).toBe(phase === "revoked" ? 0 : 1);
    expect(routines.listRuns()).toHaveLength(phase === "revoked" || phase === "fail-before" ? 0 : 1);
    expect(coordinator(journal, "none").receive({ ...event, eventId: `test_${randomUUID()}` }).state).toBe("unknown");
  } finally { routines.close(); rmSync(dir, { recursive: true, force: true }); }
});
