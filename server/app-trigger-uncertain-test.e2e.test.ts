import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { brokerClient, BrokerError } from "./app-trigger-broker.ts";
import { AppTriggerManager } from "./app-triggers.ts";
import { RoutineManager } from "./routines.ts";
import { startBrokerFake } from "./testing/broker-fake.ts";

it("does not enqueue a local duplicate when a broker accepted a test but its reply was lost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-uncertain-"));
  const fake = await startBrokerFake();
  const owner = await fake.install(), account = fake.account(owner.userId, "gmail", "fixture");
  const broker = brokerClient(() => ({ url: fake.url, token: owner.token }));
  const realTest = broker.testEvent;
  broker.testEvent = async (...args) => { await realTest(...args); throw new BrokerError("synthetic lost response", 0); };
  const routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0]);
  const options = {
    file: join(dir, "triggers.json"), broker, service: () => ({ available: true as const }),
    connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: account, status: "ACTIVE" }] } }), botState: () => "ready" as const,
    runs: { enqueue: (input: Parameters<RoutineManager["enqueueWebhook"]>[0]) => routines.enqueueWebhook(input), merge: (...args: Parameters<RoutineManager["mergeIntoQueuedRun"]>) => routines.mergeIntoQueuedRun(...args), receipt: (...args: Parameters<RoutineManager["webhookRunReceipt"]>) => routines.webhookRunReceipt(...args), pending: (id: string) => routines.activeWebhookRunCount(id), cancelQueued: (...args: Parameters<RoutineManager["cancelQueuedWebhook"]>) => routines.cancelQueuedWebhook(...args) },
  };
  try {
    const manager = new AppTriggerManager(options);
    const trigger = await manager.create({ botId: "synthetic", name: "Test fixture", prompt: "Draft a synthetic note", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    await expect(manager.runNow(trigger.id)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("may already be queued") });
    expect(routines.listRuns()).toHaveLength(0);
    expect(await manager.pollOnce(undefined, 0)).toBe(1);
    const runs = routines.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ botId: "synthetic", status: "queued", eventSource: "app" });
    const reopened = new AppTriggerManager(options);
    expect(await reopened.pollOnce(undefined, 0)).toBe(0);
    expect(routines.listRuns()).toHaveLength(1);
  } finally {
    routines.close();
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
