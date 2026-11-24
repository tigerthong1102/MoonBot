import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { brokerClient } from "./app-trigger-broker.ts";
import { createAppTriggerTestCoordinator } from "./app-trigger-test-coordinator.ts";
import { AppTriggerTestReceipts } from "./app-trigger-test-receipts.ts";
import { AppTriggerManager } from "./app-triggers.ts";
import { RoutineManager } from "./routines.ts";
import { startBrokerFake } from "./testing/broker-fake.ts";

it("recovers one accepted test through broker polling after reopening isolated stores", async () => {
  const dir = mkdtempSync(join(tmpdir(), "test-restart-broker-"));
  const fake = await startBrokerFake();
  const owner = await fake.install(), account = fake.account(owner.userId, "gmail", "fixture");
  const broker = brokerClient(() => ({ url: fake.url, token: owner.token }), fetch, { strictEvents: true });
  const journalFile = join(dir, "journal.json"), triggerFile = join(dir, "triggers.json"), runsFile = join(dir, "runs.json");
  const openRoutines = () => new RoutineManager({ file: runsFile, botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} });
  let routines = openRoutines();
  let journal = new AppTriggerTestReceipts(journalFile);
  const openManager = () => {
    const coordinator = createAppTriggerTestCoordinator({
      receipts: journal,
      validate: binding => binding.botId === "bot" && binding.accountId === account ? null : "revoked",
      admit: (binding, eventId) => routines.enqueueWebhook({ webhookId: binding.triggerId, webhookName: "Fixture", prompt: "Synthetic test", botId: binding.botId, runOn: "maus", deliveryId: eventId, receivedAt: Date.now(), eventSource: "app", receiptScope: "app-test" }),
      proof: (binding, eventId) => routines.webhookRunReceipt(binding.triggerId, eventId, "app-test"),
    });
    return new AppTriggerManager({ file: triggerFile, broker, service: () => ({ available: true }), connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: account, status: "ACTIVE" }] } }), botState: () => "ready", routeTestEvent: event => coordinator.receive(event), runs: { enqueue: input => routines.enqueueWebhook(input), merge: (...args) => routines.mergeIntoQueuedRun(...args), receipt: (...args) => routines.webhookRunReceipt(...args), pending: id => routines.activeWebhookRunCount(id), cancelQueued: (...args) => routines.cancelQueuedWebhook(...args) } });
  };
  try {
    let manager = openManager();
    const trigger = await manager.create({ botId: "bot", name: "Fixture", prompt: "Synthetic", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    const identity = { actor: "owner", requestKey: randomUUID(), botId: "bot", triggerId: trigger.id, remoteId: trigger.remote.triggerId!, accountId: account };
    const receipt = journal.reserve(identity).receipt, begun = journal.begin(identity.actor, receipt.id)!;
    let posts = 0;
    const lossyFetch: typeof fetch = async (input, init) => { posts += 1; const response = await fetch(input, init); await response.body?.cancel(); throw new Error("fixture response lost"); };
    const lossy = brokerClient(() => ({ url: fake.url, token: owner.token }), lossyFetch, { strictEvents: true });
    await expect(lossy.testEventReceipt!(identity.remoteId, { omb_test: true, note: "A test run started from StartupBot.", marker: begun.token })).rejects.toThrow("did not confirm");
    expect(posts).toBe(1);
    routines.close();
    routines = openRoutines(); journal = new AppTriggerTestReceipts(journalFile, Date.now, { requireExisting: true }); manager = openManager();
    expect(await manager.pollOnce(undefined, 0)).toBe(1);
    expect(routines.listRuns()).toHaveLength(1);
    const run = routines.listRuns()[0]!;
    expect(run.botId).toBe("bot");
    expect(journal.find(identity.actor, receipt.id)).toMatchObject({ state: "handled", runId: run.id });
    expect(await manager.pollOnce(undefined, 0)).toBe(0);
    routines.close();
    routines = openRoutines(); journal = new AppTriggerTestReceipts(journalFile, Date.now, { requireExisting: true }); manager = openManager();
    expect(await manager.pollOnce(undefined, 0)).toBe(0);
    expect(routines.listRuns().map(row => row.id)).toEqual([run.id]);
    for (const file of [journalFile, runsFile, triggerFile]) expect(readFileSync(file, "utf8")).not.toContain(begun.token);
  } finally { routines.close(); await fake.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("does not start a test that arrives after its owner cancelled it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "test-cancel-broker-")), fake = await startBrokerFake();
  const owner = await fake.install(), account = fake.account(owner.userId, "gmail", "fixture");
  const broker = brokerClient(() => ({ url: fake.url, token: owner.token }), fetch, { strictEvents: true });
  const runs = new RoutineManager({ file: join(dir, "runs.json"), botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} });
  const file = join(dir, "journal.json");
  let journal = new AppTriggerTestReceipts(file);
  const openManager = () => {
    const coordinator = createAppTriggerTestCoordinator({ receipts: journal, validate: () => null, admit: () => { throw new Error("Cancelled test ran"); }, proof: () => null });
    return new AppTriggerManager({ file: join(dir, "triggers.json"), broker, service: () => ({ available: true }), connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: account, status: "ACTIVE" }] } }), botState: () => "ready", routeTestEvent: event => coordinator.receive(event), runs: { enqueue: input => runs.enqueueWebhook(input), merge: (...args) => runs.mergeIntoQueuedRun(...args), receipt: (...args) => runs.webhookRunReceipt(...args), pending: id => runs.activeWebhookRunCount(id), cancelQueued: (...args) => runs.cancelQueuedWebhook(...args) } });
  };
  let manager = openManager();
  try {
    const trigger = await manager.create({ botId: "bot", name: "Fixture", prompt: "Synthetic", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    const identity = { actor: "owner", requestKey: randomUUID(), botId: "bot", triggerId: trigger.id, remoteId: trigger.remote.triggerId!, accountId: account };
    const receipt = journal.reserve(identity).receipt, begun = journal.begin(identity.actor, receipt.id)!;
    await broker.testEventReceipt!(identity.remoteId, { omb_test: true, note: "A test run started from StartupBot.", marker: begun.token });
    expect(journal.cancelUnclaimed(identity.actor, receipt.id)?.state).toBe("cancelled");
    journal = new AppTriggerTestReceipts(file, Date.now, { requireExisting: true });
    manager = openManager();
    expect(await manager.pollOnce(undefined, 0)).toBe(1);
    expect(await manager.pollOnce(undefined, 0)).toBe(0);
    expect(runs.listRuns()).toHaveLength(0);
    expect(new AppTriggerTestReceipts(file, Date.now, { requireExisting: true }).find(identity.actor, receipt.id)?.state).toBe("cancelled");
  } finally { runs.close(); await fake.close(); rmSync(dir, { recursive: true, force: true }); }
});
