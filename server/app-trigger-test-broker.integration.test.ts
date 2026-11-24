import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { brokerClient } from "./app-trigger-broker.ts";
import { appTestEvent, createAppTriggerTestCoordinator } from "./app-trigger-test-coordinator.ts";
import { AppTriggerTestQuarantine } from "./app-trigger-test-quarantine.ts";
import { AppTriggerTestReceipts } from "./app-trigger-test-receipts.ts";
import { AppTriggerManager, type AppTriggerManagerOptions } from "./app-triggers.ts";
import { RoutineManager } from "./routines.ts";
import { startBrokerFake } from "./testing/broker-fake.ts";

it("routes a broker-generated synthetic test once without persisting its private marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-test-broker-"));
  const fake = await startBrokerFake();
  const owner = await fake.install(), account = fake.account(owner.userId, "gmail", "fixture");
  const broker = brokerClient(() => ({ url: fake.url, token: owner.token }), fetch, { strictEvents: true });
  const routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0]);
  const observed: unknown[] = [];
  let quarantine: AppTriggerTestQuarantine | undefined;
  let journal: AppTriggerTestReceipts | undefined;
  let failCursorWrite = false;
  let route: ((event: NonNullable<ReturnType<typeof appTestEvent>>) => { state: "handled" | "rejected" | "cancelled" | "unknown" | "unrecognized" }) | undefined;
  const options: AppTriggerManagerOptions = {
    quarantineTestEvent: identity => { if (!quarantine || !journal || journal.hasPending()) throw new Error("quarantine unavailable"); quarantine.record(identity); if (failCursorWrite) { rmSync(join(dir, "triggers.json")); mkdirSync(join(dir, "triggers.json")); } },
    emit: frame => { observed.push(frame); }, log: line => { observed.push(line); },
    routeTestEvent: event => { if (!route) throw new Error("handler unavailable"); return route(event); },
    file: join(dir, "triggers.json"), broker, service: () => ({ available: true }),
    connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: account, status: "ACTIVE" }] } }), botState: () => "ready",
    runs: { enqueue: input => routines.enqueueWebhook(input), merge: (...args) => routines.mergeIntoQueuedRun(...args), receipt: (...args) => routines.webhookRunReceipt(...args), pending: id => routines.activeWebhookRunCount(id), cancelQueued: (...args) => routines.cancelQueuedWebhook(...args) },
  };
  let manager = new AppTriggerManager(options);
  try {
    const trigger = await manager.create({ botId: "bot", name: "Synthetic", prompt: "Fixture only", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    const sibling = await manager.create({ botId: "other-bot", name: "Sibling", prompt: "Other fixture", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    expect(sibling.remote.triggerId).toBe(trigger.remote.triggerId);
    journal = new AppTriggerTestReceipts(join(dir, "journal.json"));
    const identity = { actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: trigger.id, remoteId: trigger.remote.triggerId!, accountId: account };
    const receipt = journal.reserve(identity).receipt, begun = journal.begin(identity.actor, receipt.id)!;
    const submitted = await broker.testEventReceipt!(identity.remoteId, { omb_test: true, note: "A test run started from StartupBot.", marker: begun.token });
    const received = await broker.poll({ after: 0, waitS: 0, poller: "synthetic-poller" });
    expect(received.events).toHaveLength(1);
    const event = received.events[0]!;
    expect({ id: event.id, seq: event.seq }).toEqual(submitted);
    const parsed = appTestEvent(event.kind, event.triggerId!, event.id, event.event.data)!;
    expect(parsed.safeData).toEqual({ omb_test: true, note: "A test run started from StartupBot." });
    const coordinator = createAppTriggerTestCoordinator({
      receipts: journal,
      validate: binding => binding.botId === identity.botId && binding.accountId === identity.accountId ? null : "revoked",
      admit: (binding, eventId) => routines.enqueueWebhook({ webhookId: binding.triggerId, webhookName: "Synthetic", prompt: JSON.stringify(parsed.safeData), botId: binding.botId, runOn: "maus", deliveryId: eventId, receivedAt: Date.now(), eventSource: "app", receiptScope: "app-test" }),
      proof: (binding, eventId) => routines.webhookRunReceipt(binding.triggerId, eventId, "app-test"),
    });
    route = () => { throw new Error(`sensitive ${begun.token}`); };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(() => manager.receive(received.events, received.cursor)).toThrow("Could not safely process app test event");
    }
    expect(routines.listRuns()).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(dir, "triggers.json"), "utf8")).cursor).toBe(0);
    expect(readFileSync(join(dir, "triggers.json"), "utf8")).not.toContain(begun.token);
    route = () => ({ state: "unknown" });
    expect(() => manager.receive(received.events, received.cursor)).toThrow("Could not safely process app test event");
    expect(routines.listRuns()).toHaveLength(0);
    quarantine = new AppTriggerTestQuarantine(join(dir, "quarantine.json"));
    const missingMarker = { ...event, event: { ...event.event, data: { omb_test: true } } };
    expect(() => manager.receive([missingMarker], received.cursor)).toThrow("Could not safely process app test event");
    expect(quarantine.count()).toBe(0);
    const wrongRemote = { ...missingMarker, triggerId: "synthetic-other-remote" };
    expect(() => manager.receive([wrongRemote], received.cursor)).toThrow("Could not safely process app test event");
    expect(quarantine.count()).toBe(0);
    expect(new AppTriggerTestReceipts(join(dir, "journal.json")).hasPending()).toBe(true);
    route = event => coordinator.receive(event);
    manager.receive(received.events, received.cursor);
    manager.receive(received.events, received.cursor);
    const malformed = { ...event, seq: event.seq + 1, event: { ...event.event, data: { marker: begun.token, unexpected: true } } };
    const following = { ...event, seq: malformed.seq + 1, kind: "message" as const, event: { ...event.event, data: { subject: "fixture" } } };
    expect(() => manager.receive([malformed, following], following.seq)).toThrow("Could not safely process app test event");
    expect(JSON.parse(readFileSync(join(dir, "triggers.json"), "utf8")).cursor).toBe(received.cursor);
    expect(routines.listRuns()).toHaveLength(1);
    expect(routines.listRuns()[0]?.botId).toBe("bot");
    expect(JSON.stringify(routines.listRuns())).not.toContain(begun.token);
    expect(readFileSync(join(dir, "routines.json"), "utf8")).not.toContain(begun.token);
    expect(readFileSync(join(dir, "journal.json"), "utf8")).not.toContain(begun.token);
    expect(readFileSync(join(dir, "triggers.json"), "utf8")).not.toContain(begun.token);
    expect(JSON.stringify(observed)).not.toContain(begun.token);
    expect(() => manager.receive([malformed, following], following.seq)).toThrow("Could not safely process app test event");
    expect(quarantine.count()).toBe(0);
    const legacy = { ...malformed, event: { ...malformed.event, data: { omb_test: true } } };
    const damaged = join(dir, "damaged-quarantine.json");
    writeFileSync(damaged, "corrupt");
    quarantine = new AppTriggerTestQuarantine(damaged);
    expect(() => manager.receive([legacy, following], following.seq)).toThrow("Could not safely process app test event");
    expect(JSON.parse(readFileSync(join(dir, "triggers.json"), "utf8")).cursor).toBe(received.cursor);
    quarantine = new AppTriggerTestQuarantine(join(dir, "quarantine.json"));
    const previous = readFileSync(join(dir, "triggers.json"));
    failCursorWrite = true;
    expect(() => manager.receive([legacy, following], following.seq)).toThrow();
    expect(quarantine.count()).toBe(1);
    rmSync(join(dir, "triggers.json"), { recursive: true });
    writeFileSync(join(dir, "triggers.json"), previous);
    quarantine = new AppTriggerTestQuarantine(join(dir, "quarantine.json"));
    journal = new AppTriggerTestReceipts(join(dir, "journal.json"), Date.now, { requireExisting: true });
    failCursorWrite = false;
    manager = new AppTriggerManager(options);
    manager.receive([legacy, following], following.seq);
    expect(quarantine.count()).toBe(1);
    expect(new AppTriggerTestQuarantine(join(dir, "quarantine.json")).count()).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "triggers.json"), "utf8")).cursor).toBe(following.seq);
    expect(readFileSync(join(dir, "quarantine.json"), "utf8")).not.toContain(begun.token);
    expect(routines.listRuns()).toHaveLength(3);
    expect((await broker.poll({ after: received.cursor, waitS: 0, poller: "synthetic-poller" })).events).toHaveLength(0);
    const secondIdentity = { ...identity, requestKey: randomUUID() };
    const secondReceipt = journal.reserve(secondIdentity).receipt;
    const secondBegin = journal.begin(secondIdentity.actor, secondReceipt.id)!;
    let posts = 0;
    const lossyFetch: typeof fetch = async (input, init) => {
      posts += 1;
      const response = await fetch(input, init);
      await response.body?.cancel();
      throw new Error("fixture response lost after broker enqueue");
    };
    const lossy = brokerClient(() => ({ url: fake.url, token: owner.token }), lossyFetch, { strictEvents: true });
    await expect(lossy.testEventReceipt!(identity.remoteId, { omb_test: true, note: "A test run started from StartupBot.", marker: secondBegin.token })).rejects.toThrow("did not confirm");
    expect(posts).toBe(1);
    expect(journal.find(secondIdentity.actor, secondReceipt.id)?.state).toBe("sending");
    expect(journal.reserve(secondIdentity)).toMatchObject({ created: false, receipt: { id: secondReceipt.id } });
    expect(journal.begin(secondIdentity.actor, secondReceipt.id)).toBeNull();
    const queued = await broker.poll({ after: received.cursor, waitS: 0, poller: "synthetic-poller" });
    expect(queued.events).toHaveLength(1);
    journal = new AppTriggerTestReceipts(join(dir, "journal.json"), Date.now, { requireExisting: true });
    const secondEvent = queued.events[0]!;
    const secondParsed = appTestEvent(secondEvent.kind, secondEvent.triggerId!, secondEvent.id, secondEvent.event.data)!;
    const recovered = createAppTriggerTestCoordinator({
      receipts: journal,
      validate: binding => binding.botId === identity.botId && binding.accountId === identity.accountId ? null : "revoked",
      admit: (binding, eventId) => routines.enqueueWebhook({ webhookId: binding.triggerId, webhookName: "Synthetic", prompt: JSON.stringify(secondParsed.safeData), botId: binding.botId, runOn: "maus", deliveryId: eventId, receivedAt: Date.now(), eventSource: "app", receiptScope: "app-test" }),
      proof: (binding, eventId) => routines.webhookRunReceipt(binding.triggerId, eventId, "app-test"),
    });
    const beforeRecovery = routines.listRuns().length;
    expect(recovered.receive(secondParsed).state).toBe("handled");
    expect(recovered.receive(secondParsed).state).toBe("handled");
    expect(routines.listRuns()).toHaveLength(beforeRecovery + 1);
    expect(JSON.stringify(routines.listRuns())).not.toContain(secondBegin.token);
  } finally { routines.close(); await fake.close(); rmSync(dir, { recursive: true, force: true }); }
});
