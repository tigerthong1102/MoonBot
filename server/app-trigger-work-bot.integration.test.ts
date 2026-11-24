import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { brokerClient } from "./app-trigger-broker.ts";
import { AppTriggerManager } from "./app-triggers.ts";
import { linkedWorkBotOwners } from "./work-bot-linked-owners.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";
import { RoutineManager } from "./routines.ts";
import { startBrokerFake } from "./testing/broker-fake.ts";

it("queues one run for one synthetic event after a linked duplicate is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "linked-event-"));
  const broker = await startBrokerFake();
  const owner = await broker.install();
  const account = broker.account(owner.userId, "gmail", "fixture");
  const routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0]);
  const link = (targetBotId: string): WorkBotLink => ({ sourceBotId: "source", sourceThreadId: "source-thread", sourceMessageId: targetBotId, targetBotId, targetThreadId: `${targetBotId}-thread` });
  const links = [link("first"), link("target")];
  const manager = new AppTriggerManager({
    file: join(dir, "triggers.json"), broker: brokerClient(() => ({ url: broker.url, token: owner.token })), service: () => ({ available: true }),
    connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: account, status: "ACTIVE" }] } }), botState: () => "ready",
    linkedOwners: bot => linkedWorkBotOwners(bot, id => links.filter(item => item.sourceBotId === id || item.targetBotId === id)),
    runs: { enqueue: input => routines.enqueueWebhook(input), merge: (...args) => routines.mergeIntoQueuedRun(...args), receipt: (...args) => routines.webhookRunReceipt(...args), pending: id => routines.activeWebhookRunCount(id), pendingCounts: () => routines.activeWebhookRunCounts(), cancelQueued: (...args) => routines.cancelQueuedWebhook(...args) },
  });
  const create = (botId: string) => manager.create({ botId, sourceThreadId: `${botId}-thread`, name: "Synthetic watch", prompt: "Draft synthetic note", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
  try {
    const original = await create("first");
    await expect(create("target")).rejects.toMatchObject({ status: 409 });
    expect(manager.list()).toHaveLength(1);
    await broker.deliver(original.remote.triggerId!, { subject: "synthetic", sender: "fixture@example.invalid" }, "event-1");
    expect(await manager.pollOnce(undefined, 0)).toBe(1);
    expect(routines.listRuns().map(run => ({ botId: run.botId, status: run.status }))).toEqual([{ botId: "first", status: "queued" }]);
    expect(routines.activeWebhookRunCounts().get(original.id)).toBe(routines.activeWebhookRunCount(original.id));
  } finally {
    routines.close();
    await broker.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects joining two bot groups with matching existing event automations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "linked-event-groups-"));
  const broker = await startBrokerFake();
  const owner = await broker.install();
  const account = broker.account(owner.userId, "gmail", "fixture");
  const links: WorkBotLink[] = [
    { sourceBotId: "a", targetBotId: "b", sourceThreadId: "a-thread", targetThreadId: "b-thread", sourceMessageId: "one" },
    { sourceBotId: "c", targetBotId: "d", sourceThreadId: "c-thread", targetThreadId: "d-thread", sourceMessageId: "two" },
  ];
  const routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} });
  const manager = new AppTriggerManager({
    file: join(dir, "triggers.json"), broker: brokerClient(() => ({ url: broker.url, token: owner.token })), service: () => ({ available: true }),
    connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: account, status: "ACTIVE" }] } }), botState: () => "ready",
    linkedOwners: bot => linkedWorkBotOwners(bot, id => links.filter(item => item.sourceBotId === id || item.targetBotId === id)),
    runs: { enqueue: input => routines.enqueueWebhook(input), merge: (...args) => routines.mergeIntoQueuedRun(...args), receipt: (...args) => routines.webhookRunReceipt(...args), pending: id => routines.activeWebhookRunCount(id), pendingCounts: () => routines.activeWebhookRunCounts(), cancelQueued: (...args) => routines.cancelQueuedWebhook(...args) },
  });
  try {
    for (const botId of ["b", "d"]) await manager.create({ botId, name: "Synthetic watch", prompt: "Draft synthetic note", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    expect(() => manager.assertCanLink("a", "c")).toThrow("may already be watching");
    expect(() => manager.assertCanLink("a", "b")).not.toThrow();
    expect(manager.list()).toHaveLength(2);
  } finally { routines.close(); await broker.close(); rmSync(dir, { recursive: true, force: true }); }
});
