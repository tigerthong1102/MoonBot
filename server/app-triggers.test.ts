import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppTriggerRequestService } from "./app-trigger-requests.ts";
import { appEventCatalog } from "./app-event-catalog.ts";
import { eventCount } from "./app-events.ts";
import { brokerClient, type BrokerEvent } from "./app-trigger-broker.ts";
import { AppTriggerManager, type AppTriggerManagerOptions } from "./app-triggers.ts";
import { RoutineManager } from "./routines.ts";
import { WorkspaceBackupMaintenance } from "./workspace-backup-maintenance.ts";
import { startBrokerFake, type BrokerFake } from "./testing/broker-fake.ts";

let dir = "";
let broker: BrokerFake;
let owner: { id: string; token: string; userId: string };
let gmail = "";
let routines: RoutineManager;
let connected: Record<string, { connected: boolean; accounts: Array<{ id: string; alias?: string; status: string }> }>;
let failNextEnqueue: "before-save" | "after-save" | null = null;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dir = mkdtempSync(join(tmpdir(), "omb-app-triggers-"));
  broker = await startBrokerFake();
  owner = await broker.install();
  gmail = broker.account(owner.userId, "gmail", "sales");
  connected = { gmail: { connected: true, accounts: [{ id: gmail, alias: "sales", status: "ACTIVE" }] } };
  // Busy, so runs stay queued: what a burst or a catch-up meets while the bot works on the first one.
  routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
  failNextEnqueue = null;
});

afterEach(async () => {
  routines.close();
  await broker.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function manager(overrides: Partial<AppTriggerManagerOptions> = {}) {
  return new AppTriggerManager({
    file: join(dir, "app-triggers.json"),
    broker: brokerClient(() => ({ url: broker.url, token: owner.token })),
    service: () => ({ available: true }),
    connectedApps: async () => connected,
    botState: () => "ready",
    runs: {
      enqueue: (input) => {
        const failure = failNextEnqueue;
        failNextEnqueue = null;
        if (failure === "before-save") throw new Error("disk full");
        const run = routines.enqueueWebhook(input);
        if (failure === "after-save") throw new Error("crashed after the run was saved");
        return run;
      },
      merge: (triggerId, eventId, sameConversation, merge) => routines.mergeIntoQueuedRun(triggerId, eventId, sameConversation, merge),
      receipt: (triggerId, eventId) => routines.webhookRunReceipt(triggerId, eventId),
      eventRecipients: (eventId) => routines.appEventRecipients(eventId),
      pending: (triggerId) => routines.activeWebhookRunCount(triggerId),
      cancelQueued: (triggerId, message) => routines.cancelQueuedWebhook(triggerId, message),
    },
    log: () => {},
    ...overrides,
  });
}

const runsOf = (triggerId: string) => routines.listRuns().filter((run) => run.routineId === triggerId);
const heldEvents = () => JSON.parse(readFileSync(join(dir, "app-triggers.json.held"), "utf8")).events as Array<{ id: string; reason: string; event?: BrokerEvent }>;
const drain = async (triggers: AppTriggerManager) => { while (await triggers.pollOnce(undefined, 0) > 0) { /* until the queue is empty */ } };

async function gmailTrigger(triggers: AppTriggerManager, filter = { from: "acme.com", subject: "order" }) {
  return triggers.create({ botId: "bot-1", name: "Order replies", prompt: "Draft a reply with the order status.", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", filter });
}

describe("AppTriggerManager", () => {
  it.each([false, true])("waits for app-event polling to stop and resumes after backup failure=%s", async fail => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const triggers = manager({ broker: client });
    await gmailTrigger(triggers);
    let activePolls = 0;
    const poll = vi.spyOn(client, "poll").mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      activePolls++;
      const stop = () => { activePolls--; reject(new Error("fixture poll aborted")); };
      if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
    }));
    triggers.start();
    try {
      await expect.poll(() => activePolls, { timeout: 5000 }).toBe(1);
      const gate = new WorkspaceBackupMaintenance();
      const run = gate.run(async () => { expect(activePolls).toBe(0); if (fail) throw new Error("fixture backup failure"); }, {
        idle: () => true, pause: () => {}, flush: () => triggers.stop(), resume: () => triggers.start(),
      });
      if (fail) await expect(run).rejects.toThrow("fixture backup failure"); else await expect(run).resolves.toBeUndefined();
      await expect.poll(() => poll.mock.calls.length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    } finally { await triggers.stop(); }
    expect(activePolls).toBe(0);
  });
  it("keeps a shared event held after a pause and restart", async () => {
    const links = (first: string, second: string) => [first, second].sort().join(":") === "bot-1:bot-2";
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    const second = await triggers.create({ botId: "bot-2", name: "Duplicate fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    expect(second.remote.triggerId).toBe(first.remote.triggerId);
    await expect(triggers.runNow(first.id)).rejects.toMatchObject({ status: 409 });
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_linked_conflict");
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(heldEvents()[0]?.event?.id).toBe(heldEvents()[0]?.id);
    expect(routines.listRuns()).toHaveLength(0);
    expect(triggers.get(first.id)?.problem?.kind).toBe("error");
    await triggers.reconcile();
    expect(triggers.get(first.id)?.problem?.kind).toBe("error");
    triggers = manager({ linkedBots: links });
    await triggers.pollOnce(undefined, 0);
    expect(routines.listRuns()).toHaveLength(0);
    await triggers.update(second.id, { enabled: false });
    triggers = manager({ linkedBots: links });
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("keeps fan-out for independent bots sharing a remote event", async () => {
    const triggers = manager({ linkedBots: () => false });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Other fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_independent");
    await triggers.pollOnce(undefined, 0);
    expect(routines.listRuns()).toHaveLength(2);
  });

  it("persists a conflicted event while allowing the following unrelated event to run", async () => {
    const links = (first: string, second: string) => [first, second].sort().join(":") === "bot-1:bot-2";
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Duplicate fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    const other = await triggers.create({ botId: "bot-3", name: "Independent fixture", prompt: "Other", app: "gmail", event: first.event, filter: { from: "other.example" } });
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_conflict_first");
    await broker.deliver(other.remote.triggerId!, { sender: "person@other.example" }, "msg_independent_second");
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(heldEvents()[0]?.event?.id).toBe(heldEvents()[0]?.id);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
    triggers = manager({ linkedBots: links });
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
  });

  it("holds linked recipients while delivering the same event once to an independent bot after replay", async () => {
    const links = (first: string, second: string) => [first, second].sort().join(":") === "bot-1:bot-2";
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Linked", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    const third = await triggers.create({ botId: "bot-3", name: "Independent", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    expect(third.remote.triggerId).toBe(first.remote.triggerId);
    const main = join(dir, "app-triggers.json"), beforeCheckpoint = readFileSync(main, "utf8");
    const event = { seq: 1, id: "fixture-shared", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: { subject: "Order fixture", sender: "person@acme.com" } } };
    triggers.receive([event], 1);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
    expect(heldEvents()).toHaveLength(1);
    writeFileSync(main, beforeCheckpoint);
    routines.close();
    routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    triggers = manager({ linkedBots: links });
    triggers.receive([event], 1);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
  });

  it("replays an independent recipient after a failure between hold and enqueue", async () => {
    const links = (first: string, second: string) => [first, second].sort().join(":") === "bot-1:bot-2";
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Linked", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.create({ botId: "bot-3", name: "Independent", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    const event = { seq: 1, id: "fixture-before-enqueue", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: { subject: "Order fixture", sender: "person@acme.com" } } };
    for (let attempt = 0; attempt < 6; attempt++) {
      failNextEnqueue = "before-save";
      expect(() => triggers.receive([event], 1)).toThrow("retry is required");
      expect(JSON.parse(readFileSync(join(dir, "app-triggers.json"), "utf8")).cursor).toBe(0);
    }
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
    triggers = manager();
    expect(() => triggers.receive([event], 1)).toThrow();
    expect(JSON.parse(readFileSync(join(dir, "app-triggers.json"), "utf8")).cursor).toBe(0);
    triggers = manager({ linkedBots: links });
    triggers.receive([event], 1);
    triggers.receive([event], 1);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
  });

  it("does not discard an independent recipient when relationship lookup fails on retry", async () => {
    let unavailable = false;
    const links = (first: string, second: string) => { if (unavailable) throw new Error("fixture graph unavailable"); return [first, second].sort().join(":") === "bot-1:bot-2"; };
    const triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Linked", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.create({ botId: "bot-3", name: "Independent", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    const event = { seq: 1, id: "fixture-graph-error", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: { subject: "Order fixture", sender: "person@acme.com" } } };
    failNextEnqueue = "before-save";
    expect(() => triggers.receive([event], 1)).toThrow();
    unavailable = true;
    expect(() => triggers.receive([event], 1)).toThrow();
    expect(JSON.parse(readFileSync(join(dir, "app-triggers.json"), "utf8")).cursor).toBe(0);
    unavailable = false;
    triggers.receive([event], 1);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
  });

  it("does not replay a held event to a bot that was paused at capture", async () => {
    const links = (first: string, second: string) => [first, second].sort().join(":") === "bot-1:bot-2";
    const triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Linked", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    const third = await triggers.create({ botId: "bot-3", name: "Paused", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.update(third.id, { enabled: false });
    const event = { seq: 1, id: "fixture-paused", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: { subject: "Order fixture", sender: "person@acme.com" } } };
    triggers.receive([event], 1);
    await triggers.update(third.id, { enabled: true });
    triggers.receive([event], 1);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("does not duplicate an unrelated run after a crash before the cursor checkpoint", async () => {
    const links = (first: string, second: string) => [first, second].sort().join(":") === "bot-1:bot-2";
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Duplicate fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    const other = await triggers.create({ botId: "bot-3", name: "Independent fixture", prompt: "Other", app: "gmail", event: first.event, filter: { from: "other.example" } });
    const main = join(dir, "app-triggers.json"), beforeCheckpoint = readFileSync(main, "utf8");
    const at = Date.now();
    const events = [
      { seq: 1, id: "fixture-conflict", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: at, event: { data: { subject: "Order fixture", sender: "person@acme.com" } } },
      { seq: 2, id: "fixture-unrelated", kind: "message" as const, triggerId: other.remote.triggerId!, receivedAt: at, event: { data: { sender: "person@other.example" } } },
    ];
    triggers.receive(events, 2);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
    writeFileSync(main, beforeCheckpoint);
    routines.close();
    routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    triggers = manager({ linkedBots: links });
    triggers.receive(events, 2);
    expect(routines.listRuns().map(run => run.botId)).toEqual(["bot-3"]);
    expect(heldEvents()).toHaveLength(1);
  });

  it("keeps held payloads when an older version removes metadata from the main file", async () => {
    const links = () => true;
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Duplicate fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_downgrade_fixture");
    await triggers.pollOnce(undefined, 0);
    const held = heldEvents()[0]!;
    const file = join(dir, "app-triggers.json"), old = JSON.parse(readFileSync(file, "utf8"));
    delete old.heldEvents;
    delete old.bindingOwners;
    writeFileSync(file, JSON.stringify(old));
    triggers = manager({ linkedBots: links });
    expect(heldEvents()).toEqual([held]);
    expect(held.event).toBeDefined();
    triggers.receive([held.event!], 100);
    expect(routines.listRuns()).toHaveLength(0);
    expect(heldEvents()).toEqual([held]);
  });

  it("does not change automations or acknowledge an event when held storage is unreadable", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    let triggers = manager({ linkedBots: () => false, broker: client });
    const first = await gmailTrigger(triggers);
    const file = join(dir, "app-triggers.json.held"), broken = "{ broken held fixture";
    writeFileSync(file, broken);
    const inventory = vi.spyOn(client, "inventory"), testEvent = vi.spyOn(client, "testEvent"), poll = vi.spyOn(client, "poll");
    triggers = manager({ linkedBots: () => false, broker: client });
    await expect(triggers.update(first.id, { enabled: false })).rejects.toMatchObject({ status: 503 });
    await expect(triggers.reconcile()).rejects.toMatchObject({ status: 503 });
    await expect(triggers.runNow(first.id)).rejects.toMatchObject({ status: 503 });
    await expect(triggers.pollOnce(undefined, 0)).rejects.toMatchObject({ status: 503 });
    expect(inventory).not.toHaveBeenCalled();
    expect(testEvent).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    const event = { seq: 100, id: "fixture-event", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: {} } };
    expect(() => triggers.receive([event], 100)).toThrow(/Held app events/);
    expect(readFileSync(file, "utf8")).toBe(broken);
    expect(JSON.parse(readFileSync(join(dir, "app-triggers.json"), "utf8")).cursor).toBe(0);
  });

  it("refuses to overwrite a profile whose acknowledged held-event file is missing", async () => {
    const links = () => true;
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Duplicate fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_missing_hold");
    await triggers.pollOnce(undefined, 0);
    const main = join(dir, "app-triggers.json"), before = readFileSync(main, "utf8");
    rmSync(join(dir, "app-triggers.json.held"));
    triggers = manager({ linkedBots: links });
    await expect(triggers.update(first.id, { enabled: false })).rejects.toMatchObject({ status: 503 });
    expect(readFileSync(main, "utf8")).toBe(before);
  });

  it("refuses a held store whose event ID does not match its key", async () => {
    let triggers = manager({ linkedBots: () => false });
    const first = await gmailTrigger(triggers);
    const file = join(dir, "app-triggers.json.held");
    writeFileSync(file, JSON.stringify({ version: 1, events: [{ id: "fixture-a", reason: "conflict", event: { id: "fixture-b", seq: 1, kind: "message", triggerId: first.remote.triggerId, receivedAt: Date.now(), event: { data: {} } } }] }));
    triggers = manager({ linkedBots: () => false });
    await expect(triggers.update(first.id, { enabled: false })).rejects.toMatchObject({ status: 503 });
    expect(triggers.get(first.id)?.enabled).toBe(true);
  });

  it("does not acknowledge a conflicted event when held-event storage reaches its limit", async () => {
    const triggers = manager({ linkedBots: () => true });
    const first = await gmailTrigger(triggers);
    await triggers.create({ botId: "bot-2", name: "Duplicate fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    const events = Array.from({ length: 101 }, (_, index) => ({ seq: index + 1, id: `fixture-${index}`, kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: { subject: "Order fixture", sender: "person@acme.com" } } }));
    expect(() => triggers.receive(events, 101)).toThrow(/storage is full/);
    const saved = JSON.parse(readFileSync(join(dir, "app-triggers.json"), "utf8"));
    expect(saved.cursor).toBe(100);
    expect(saved.heldEvents).toHaveLength(100);
    expect(heldEvents()).toHaveLength(100);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("does not transfer an older event merely because its original automation was paused", async () => {
    const links = () => true;
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_before_second_bot");
    await triggers.create({ botId: "bot-2", name: "New fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.pollOnce(undefined, 0);
    await triggers.update(first.id, { enabled: false });
    triggers = manager({ linkedBots: links });
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("holds an older event if the original automation is paused before the first poll", async () => {
    const triggers = manager({ linkedBots: () => true });
    const first = await gmailTrigger(triggers);
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_pause_before_poll");
    await triggers.create({ botId: "bot-2", name: "New fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.update(first.id, { enabled: false });
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("remembers the original binding owner when it is removed before the first poll", async () => {
    const links = () => true;
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_remove_before_poll");
    await triggers.create({ botId: "bot-2", name: "New fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.remove(first.id);
    triggers = manager({ linkedBots: links });
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("remembers the original binding owner when it changes filter before the first poll", async () => {
    const links = () => true;
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_rebind_before_poll");
    await triggers.create({ botId: "bot-2", name: "New fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.update(first.id, { filter: { from: "other.example" } });
    triggers = manager({ linkedBots: links });
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("persists events while the routine receipt store is unreadable", async () => {
    const triggers = manager({ linkedBots: () => false });
    const first = await gmailTrigger(triggers);
    routines.close();
    const file = join(dir, "routines.json");
    writeFileSync(file, "{ broken fixture");
    routines = new RoutineManager({ file, botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_unreadable");
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()[0]?.reason).toBe("unknown");
    expect(triggers.attempts().some(attempt => attempt.outcome === "rejected")).toBe(false);
    routines.close();
    writeFileSync(file, "{}");
    routines = new RoutineManager({ file, botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    await triggers.pollOnce(undefined, 0);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
  });

  it("persists an in-flight event after its last binding disappears and history is unreadable", async () => {
    const triggers = manager({ linkedBots: () => false });
    const first = await gmailTrigger(triggers);
    await triggers.remove(first.id);
    routines.close();
    const file = join(dir, "routines.json");
    writeFileSync(file, "{ broken fixture");
    routines = new RoutineManager({ file, botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    const event = { seq: 100, id: "fixture-event", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: {} } };
    triggers.receive([event], 100);
    expect(triggers.attempts()).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "app-triggers.json"), "utf8")).cursor).toBe(100);
    expect(heldEvents()[0]).toMatchObject({ id: event.id, reason: "unknown", event });
  });

  it("retains malformed receipt rows without disabling unrelated saved routines", async () => {
    const file = join(dir, "routines.json");
    const routine = routines.create({ name: "Fixture", prompt: "Fixture", botId: "bot-1", enabled: true, schedule: { type: "interval", everyMinutes: 5, anchorAt: Date.now() + 3_600_000 } });
    routines.enqueueWebhook({ webhookId: "trigger-fixture", webhookName: "Fixture", prompt: "Fixture", botId: "bot-1", runOn: "maus", deliveryId: "event-fixture", receivedAt: Date.now(), eventSource: "app" });
    routines.close();
    const before = JSON.parse(readFileSync(file, "utf8"));
    const damaged = { webhookId: "broken-fixture", unexpected: "preserve-me" };
    before.webhookRunReceipts.push(damaged);
    writeFileSync(file, JSON.stringify(before));
    routines = new RoutineManager({ file, botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    expect(routines.schedulerState().unreadable).toBe(false);
    expect(routines.listRoutines().find(row => row.id === routine.id)?.enabled).toBe(true);
    await routines.tick();
    expect(routines.listRoutines().find(row => row.id === routine.id)?.enabled).toBe(true);
    expect(routines.listRuns()).toHaveLength(1);
    expect(() => routines.appEventRecipients("event-fixture")).toThrow(/unavailable/);
    routines.create({ name: "Second fixture", prompt: "Fixture", botId: "bot-1", enabled: false, schedule: { type: "interval", everyMinutes: 5, anchorAt: Date.now() } });
    expect(JSON.parse(readFileSync(file, "utf8")).webhookRunReceipts).toContainEqual(damaged);
    routines.close();
    const repaired = JSON.parse(readFileSync(file, "utf8"));
    repaired.webhookRunReceipts = repaired.webhookRunReceipts.filter((row: { webhookId?: string }) => row.webhookId !== "broken-fixture");
    writeFileSync(file, JSON.stringify(repaired));
    routines = new RoutineManager({ file, botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    expect(routines.listRoutines().find(row => row.id === routine.id)?.enabled).toBe(true);
    expect(routines.listRuns()).toHaveLength(1);
    expect(routines.appEventRecipients("event-fixture")).toEqual(["bot-1"]);
  });

  it("does not replay an event to a linked bot after the original recipient is paused", async () => {
    const triggers = manager({ linkedBots: () => true });
    const first = await gmailTrigger(triggers);
    const data = { subject: "Order fixture", sender: "person@acme.com" };
    await broker.deliver(first.remote.triggerId!, data, "msg_already_delivered");
    await triggers.pollOnce(undefined, 0);
    const delivery = routines.listRuns()[0]!.deliveryId!;
    const second = await triggers.create({ botId: "bot-2", name: "New fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.update(first.id, { enabled: false });
    const event = { seq: 100, id: delivery, kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data } };
    triggers.receive([event], 100);
    expect(routines.listRuns()).toHaveLength(1);
    await triggers.update(second.id, { enabled: false });
    await triggers.update(first.id, { enabled: true });
    triggers.receive([event], 100);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(1);
  });

  it("retains the event owner after its original automation is deleted and the manager restarts", async () => {
    const links = () => true;
    let triggers = manager({ linkedBots: links });
    const first = await gmailTrigger(triggers);
    const data = { subject: "Order fixture", sender: "person@acme.com" };
    await broker.deliver(first.remote.triggerId!, data, "msg_deleted_owner");
    await triggers.pollOnce(undefined, 0);
    const delivery = routines.listRuns()[0]!.deliveryId!;
    await triggers.create({ botId: "bot-2", name: "New fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.remove(first.id);
    routines.close();
    routines = new RoutineManager({ file: join(dir, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "thread-run" }), startTurn: async () => {} });
    triggers = manager({ linkedBots: links });
    const event = { seq: 100, id: delivery, kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data } };
    triggers.receive([event], 100);
    expect(heldEvents()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(1);
  });

  it("keeps an event when both linked automations were paused before it arrived", async () => {
    let linkLookupFails = true;
    const triggers = manager({ linkedBots: () => { if (linkLookupFails) throw new Error("fixture DB unavailable"); return true; } });
    const first = await gmailTrigger(triggers);
    const second = await triggers.create({ botId: "bot-2", name: "New fixture", prompt: first.prompt, app: "gmail", event: first.event, filter: first.filter });
    await triggers.update(first.id, { enabled: false });
    await triggers.update(second.id, { enabled: false });
    const event = { seq: 100, id: "fixture-event", kind: "message" as const, triggerId: first.remote.triggerId!, receivedAt: Date.now(), event: { data: { subject: "Order fixture", sender: "person@acme.com" } } };
    triggers.receive([event], 100);
    linkLookupFails = false;
    triggers.receive([event], 100);
    const secondEvent = { ...event, id: "second-fixture-event", seq: 101 };
    triggers.receive([secondEvent], 101);
    expect(routines.listRuns()).toHaveLength(0);
    await triggers.update(first.id, { enabled: true });
    triggers.receive([secondEvent], 101);
    expect(heldEvents()).toHaveLength(2);
    expect(routines.listRuns()).toHaveLength(0);
  });
  it("reports in-flight creation before network validation and until all concurrent calls finish", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const type = await client.triggerType("GMAIL_NEW_GMAIL_MESSAGE");
    const releases: Array<() => void> = [];
    vi.spyOn(client, "triggerType").mockImplementation(() => new Promise(resolve => releases.push(() => resolve(type))));
    const triggers = manager({ broker: client });
    expect(triggers.mutationActivity()).toBe("no-mutation");
    const first = gmailTrigger(triggers);
    const second = gmailTrigger(triggers);
    expect(triggers.mutationActivity()).toBe("changing");
    expect(triggers.list()).toEqual([]);
    releases[0]!();
    await first;
    expect(triggers.mutationActivity()).toBe("changing");
    releases[1]!();
    await expect(second).rejects.toMatchObject({ status: 409 });
    expect(triggers.mutationActivity()).toBe("no-mutation");
  });

  it("does not call an unreadable trigger store idle", () => {
    const triggers = manager({ file: dir });
    expect(triggers.mutationActivity()).toBe("unreadable");
  });

  it("reports a restore while the broker has bound it but the local record is not yet saved", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const triggers = manager({ broker: client });
    const saved = await gmailTrigger(triggers);
    await triggers.remove(saved.id);
    const create = client.create.bind(client);
    let entered!: () => void, release!: () => void;
    const bound = new Promise<void>(resolve => { entered = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(client, "create").mockImplementationOnce(async input => { const result = await create(input); entered(); await proceed; return result; });
    const restoring = triggers.restore(saved.id);
    await bound;
    expect(triggers.list()).toEqual([]);
    expect(triggers.mutationActivity()).toBe("changing");
    release();
    expect((await restoring)?.id).toBe(saved.id);
    expect(triggers.mutationActivity()).toBe("no-mutation");
  });

  it("reports reconfiguration while event metadata is still loading", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const triggers = manager({ broker: client });
    const saved = await gmailTrigger(triggers);
    const type = await client.triggerType(saved.event);
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(client, "triggerType").mockImplementationOnce(async () => { entered(); await proceed; return type; });
    const updating = triggers.update(saved.id, { filter: { from: "changed.example" } });
    await waiting;
    expect(triggers.mutationActivity()).toBe("changing");
    release();
    await updating;
    expect(triggers.mutationActivity()).toBe("no-mutation");
  });

  it("retries an unrelated event after a concurrent automation mutation finishes", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const triggers = manager({ broker: client, linkedBots: () => false });
    const first = await gmailTrigger(triggers);
    const type = await client.triggerType(first.event);
    await broker.deliver(first.remote.triggerId!, { subject: "Order fixture", sender: "person@acme.com" }, "msg_other_mutation");
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(client, "triggerType").mockImplementationOnce(async () => { entered(); await proceed; return type; });
    const creating = triggers.create({ botId: "independent", name: "Other", prompt: "Other work", app: "gmail", event: first.event, filter: { from: "other.example" } });
    await waiting;
    await expect(triggers.pollOnce(undefined, 0)).rejects.toThrow(/Event history or bot links/);
    release();
    await creating;
    await triggers.pollOnce(undefined, 0);
    expect(routines.listRuns()).toHaveLength(1);
    expect(routines.listRuns()[0]?.botId).toBe("bot-1");
  });

  it("rejects a concurrent duplicate before one event can queue two runs", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const type = await client.triggerType("GMAIL_NEW_GMAIL_MESSAGE");
    vi.spyOn(client, "triggerType").mockResolvedValue(type);
    const triggers = manager({ broker: client });
    const results = await Promise.allSettled([gmailTrigger(triggers), gmailTrigger(triggers)]);
    const created = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    expect(created).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toMatchObject([{ reason: { status: 409 } }]);
    expect(triggers.list()).toHaveLength(1);
    expect(broker.harness.composio.instances.size).toBe(1);
    await broker.deliver(created[0]!.remote.triggerId!, { subject: "Order #7", sender: "person@acme.com" }, "msg_concurrent");
    await triggers.pollOnce(undefined, 0);
    expect(routines.listRuns()).toHaveLength(1);
  });

  it("refuses a bot replacement when a direct edit adds protected instructions during its network wait", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const triggers = manager({ broker: client });
    const saved = await gmailTrigger(triggers);
    const store = { messagesFor: () => [], appendMessage: vi.fn(() => ({ id: "message-1" })), patchMessage: vi.fn() };
    const service = new AppTriggerRequestService({ triggers, store, botName: () => "Fixture" });
    const type = await client.triggerType(saved.event);
    let entered!: () => void;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(client, "triggerType").mockImplementationOnce(async () => { entered(); await resume; return type; });
    const outcome = service.submit({ botId: saved.botId, threadId: "thread-a", operation: {
      action: "update", triggerId: saved.id, changes: { name: "Must not apply", instructions: "Bot replacement", filter: { from: "changed.example" } },
    } }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await blocked;
    const protectedPrompt = "Use token=fixture-private-value.";
    let before!: ReturnType<AppTriggerManager["list"]>;
    let remote!: Array<unknown>;
    try {
      await triggers.update(saved.id, { prompt: protectedPrompt });
      before = structuredClone(triggers.list());
      remote = structuredClone([...broker.harness.composio.instances.entries()]);
    } finally { release(); }
    expect((await outcome).error).toMatchObject({ status: 409 });
    expect(triggers.list()).toEqual(before);
    expect([...broker.harness.composio.instances.entries()]).toEqual(remote);
    expect(store.appendMessage).not.toHaveBeenCalled();
  });

  it("refuses a bot replacement queued behind a direct edit that stores protected instructions", async () => {
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const triggers = manager({ broker: client });
    const saved = await gmailTrigger(triggers);
    const store = { messagesFor: () => [], appendMessage: vi.fn(() => ({ id: "message-1" })), patchMessage: vi.fn() };
    const service = new AppTriggerRequestService({ triggers, store, botName: () => "Fixture" });
    let entered!: () => void;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const setEnabled = client.setEnabled.bind(client);
    vi.spyOn(client, "setEnabled").mockImplementationOnce(async (...args) => { entered(); await resume; await setEnabled(...args); });
    const holding = triggers.update(saved.id, { name: "Holding update" });
    await blocked;
    const protectedPrompt = "Use token=fixture-private-value.";
    const manual = triggers.update(saved.id, { prompt: protectedPrompt });
    const outcome = service.submit({ botId: saved.botId, threadId: "thread-a", operation: {
      action: "update", triggerId: saved.id, changes: { name: "Must not apply", instructions: "Bot replacement" },
    } }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    release();
    await holding;
    const expected = await manual;
    expect((await outcome).error).toMatchObject({ status: 409 });
    expect(triggers.get(saved.id)).toEqual(expected);
    expect(store.appendMessage).not.toHaveBeenCalled();
  });

  it("refuses replacing redacted app instructions before changing local or remote state", async () => {
    const triggers = manager();
    const prompt = "Review the queue.\n".repeat(180) + "Use token=fixture-secret-value.";
    const saved = await triggers.create({ botId: "bot-1", name: "Private instructions", prompt, app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    const store = { messagesFor: () => [], appendMessage: vi.fn(() => ({ id: "message-1" })), patchMessage: vi.fn() };
    const service = new AppTriggerRequestService({ triggers, store, botName: () => "Fixture" });
    const submit = (changes: unknown) => service.submit({ botId: "bot-1", threadId: "thread-a", operation: { action: "update", triggerId: saved.id, changes } });
    const before = structuredClone(triggers.list());
    const remote = structuredClone([...broker.harness.composio.instances.entries()]);
    await expect(submit({ name: "Must not apply", instructions: "Only the visible text.", filter: { from: "changed.example" } }))
      .rejects.toMatchObject({ status: 409 });
    expect(triggers.list()).toEqual(before);
    expect([...broker.harness.composio.instances.entries()]).toEqual(remote);
    expect(store.appendMessage).not.toHaveBeenCalled();
    await submit({ name: "Safe rename" });
    expect(triggers.get(saved.id)).toMatchObject({ name: "Safe rename", prompt });
    const edited = prompt + " Changed by the person.";
    await triggers.update(saved.id, { prompt: edited });
    expect(triggers.get(saved.id)?.prompt).toBe(edited);
  });

  it("creates the service copy with a Gmail filter folded into Gmail's own search", async () => {
    const triggers = manager();
    const trigger = await gmailTrigger(triggers);
    expect(trigger).toMatchObject({ remote: { state: "active" }, accountId: gmail, accountLabel: "sales", delivery: "poll", eventName: "New Gmail message" });
    const instance = broker.harness.composio.instances.get(trigger.remote.triggerId!);
    expect(instance?.trigger_config).toEqual({ query: "from:acme.com subject:(order)" });
  });

  it("acks an event only after its run is saved: a failure before the save brings the same event back once", async () => {
    const triggers = manager();
    const trigger = await gmailTrigger(triggers);
    expect((await broker.deliver(trigger.remote.triggerId!, { subject: "Order #1042", sender: "j@acme.com" }, "msg_1")).status).toBe(200);
    failNextEnqueue = "before-save";
    await expect(triggers.pollOnce(undefined, 0)).rejects.toThrow("disk full");
    expect(runsOf(trigger.id)).toHaveLength(0);
    await triggers.pollOnce(undefined, 0);
    expect(runsOf(trigger.id)).toHaveLength(1);
    expect(runsOf(trigger.id)[0]).toMatchObject({ triggerSource: "webhook", eventSource: "app", deliveryId: "msg_1" });
    expect(broker.harness.d1.rows("SELECT * FROM events WHERE acked_at IS NULL")).toHaveLength(1);
    await triggers.pollOnce(undefined, 0);
    expect(broker.harness.d1.rows("SELECT * FROM events WHERE acked_at IS NULL")).toHaveLength(0);
  });

  it("dedupes a redelivered event: a crash after the run was saved starts no second run", async () => {
    const triggers = manager();
    const trigger = await gmailTrigger(triggers);
    await broker.deliver(trigger.remote.triggerId!, { subject: "Order #7" }, "msg_dup");
    failNextEnqueue = "after-save";
    await expect(triggers.pollOnce(undefined, 0)).rejects.toThrow("crashed");
    await triggers.pollOnce(undefined, 0);
    expect(runsOf(trigger.id)).toHaveLength(1);
    expect(eventCount(runsOf(trigger.id)[0]!.prompt)).toBe(1);
    expect(triggers.attempts().map((attempt) => attempt.outcome)).toEqual(["duplicate"]);
    expect(triggers.get(trigger.id)?.received).toBe(0);
  });

  it("turns a burst into at most three runs of up to twenty events, and skips past that", async () => {
    const triggers = manager();
    const trigger = await gmailTrigger(triggers);
    for (let index = 0; index < 50; index += 1) await broker.deliver(trigger.remote.triggerId!, { subject: `Order #${index}`, sender: "j@acme.com" });
    await drain(triggers);
    const runs = runsOf(trigger.id);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => eventCount(run.prompt)).sort((a, b) => a - b)).toEqual([10, 20, 20]);
    for (let index = 0; index < 30; index += 1) await broker.deliver(trigger.remote.triggerId!, { subject: `Late #${index}` });
    await drain(triggers);
    expect(runsOf(trigger.id)).toHaveLength(3);
    expect(runsOf(trigger.id).reduce((sum, run) => sum + eventCount(run.prompt), 0)).toBe(60);
    const after = triggers.get(trigger.id)!;
    expect(after.received).toBe(60);
    expect(after.skipped?.tooMany).toBe(20);
    expect(triggers.attempts().filter((attempt) => attempt.outcome === "skipped")).toHaveLength(20);
  });

  it("applies a plain filter to apps that cannot filter at the source", async () => {
    const slack = broker.account(owner.userId, "slack");
    connected.slack = { connected: true, accounts: [{ id: slack, status: "ACTIVE" }] };
    const triggers = manager();
    const trigger = await triggers.create({ botId: "bot-1", name: "Urgent", prompt: "Tell me.", app: "slack", event: "SLACK_CHANNEL_MESSAGE_RECEIVED", filter: { text: "urgent" } });
    await broker.deliver(trigger.remote.triggerId!, { text: "lunch?", user: "ada" });
    await broker.deliver(trigger.remote.triggerId!, { text: "URGENT: the site is down", user: "bo" });
    await drain(triggers);
    expect(runsOf(trigger.id)).toHaveLength(1);
    expect(runsOf(trigger.id)[0]!.prompt).toContain("the site is down");
    expect(triggers.get(trigger.id)).toMatchObject({ received: 1, filtered: 1 });
  });

  it("reconciles: a lost copy is made again, one nobody wants is removed, and on/off is matched", async () => {
    const triggers = manager();
    const kept = await gmailTrigger(triggers);
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    await client.remove(kept.remote.triggerId!);
    const stray = await client.create({ slug: "GMAIL_NEW_GMAIL_MESSAGE", connectedAccountId: gmail, config: { query: "stray" } });
    await triggers.reconcile();
    const healed = triggers.get(kept.id)!;
    expect(healed.remote).toMatchObject({ state: "active" });
    expect(broker.harness.composio.instances.has(healed.remote.triggerId!)).toBe(true);
    expect(broker.harness.composio.instances.has(stray.triggerId)).toBe(false);
    await client.setEnabled(healed.remote.triggerId!, false);
    await triggers.reconcile();
    expect((await client.inventory()).triggers.find((binding) => binding.triggerId === healed.remote.triggerId)?.enabled).toBe(true);
    await triggers.update(kept.id, { enabled: false });
    expect((await client.inventory()).triggers.find((binding) => binding.triggerId === healed.remote.triggerId)?.enabled).toBe(false);
  });

  it("pauses the automation of a deleted bot, so the app stops sending its events", async () => {
    let gone = false;
    const triggers = manager({ botState: () => (gone ? "missing" : "ready") });
    const trigger = await gmailTrigger(triggers);
    gone = true;
    await triggers.reconcile();
    expect(triggers.get(trigger.id)?.enabled).toBe(false);
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    expect((await client.inventory()).triggers.find((binding) => binding.triggerId === trigger.remote.triggerId)?.enabled).toBe(false);
  });

  it("says an event that needs setup on our side can't be used yet, and an unknown one can't be watched", async () => {
    const triggers = manager();
    const create = (event: string) => triggers.create({ botId: "bot-1", name: "New mail", prompt: "Summarize it.", app: "gmail", event });
    await expect(create("GMAIL_OWN_ENDPOINT")).rejects.toThrow("GMAIL_OWN_ENDPOINT can't be used yet: this event needs webhook setup on our side first. Pick another event this app offers.");
    await expect(create("GMAIL_NOT_A_THING")).rejects.toThrow("GMAIL_NOT_A_THING is not an event StartupBot can watch.");
    expect(triggers.list()).toEqual([]);
  });

  it("keeps an automation pending while the service is unreachable, and finishes it on its own", async () => {
    let reachable = false;
    const triggers = manager({ broker: brokerClient(() => ({ url: reachable ? broker.url : "http://127.0.0.1:9", token: owner.token })) });
    await expect(gmailTrigger(triggers)).rejects.toThrow(/could not be reached/);
    reachable = true;
    const trigger = await gmailTrigger(triggers);
    reachable = false;
    await triggers.update(trigger.id, { filter: { from: "globex.com" } }).catch(() => {});
    reachable = true;
    await triggers.reconcile();
    expect(triggers.get(trigger.id)?.remote.state).toBe("active");
  });

  it("shows an expired connection as Reconnect, and clears it once the account works again", async () => {
    const triggers = manager();
    const trigger = await gmailTrigger(triggers);
    await broker.expire(gmail);
    await drain(triggers);
    expect(triggers.get(trigger.id)?.problem?.kind).toBe("reconnect");
    connected.gmail!.accounts[0]!.status = "ACTIVE";
    await triggers.reconcile();
    expect(triggers.get(trigger.id)?.problem).toBeUndefined();
  });

  it("counts events the service skipped today for the daily limit", async () => {
    const triggers = manager();
    const trigger = await gmailTrigger(triggers);
    await triggers.reconcile();
    broker.setQueuedToday(owner.id, 500);
    await broker.deliver(trigger.remote.triggerId!, { subject: "Over the limit" });
    await broker.deliver(trigger.remote.triggerId!, { subject: "Also over" });
    await triggers.reconcile();
    expect(triggers.get(trigger.id)?.skipped).toMatchObject({ dailyLimit: 2 });
    expect(triggers.service()).toMatchObject({ plan: "desktop", eventsPerDay: 500, eventsToday: 500 });
  });

  it("deletes the service copy with the last automation that uses it, and Undo brings it back", async () => {
    const triggers = manager();
    const first = await gmailTrigger(triggers);
    const twin = await triggers.create({ botId: "bot-2", name: "Twin", prompt: "Log it.", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", filter: { from: "acme.com", subject: "order" } });
    expect(twin.remote.triggerId).toBe(first.remote.triggerId);
    await triggers.remove(first.id);
    expect(broker.harness.composio.instances.has(twin.remote.triggerId!)).toBe(true);
    await triggers.remove(twin.id);
    expect(broker.harness.composio.instances.size).toBe(0);
    const restored = await triggers.restore(twin.id);
    expect(restored?.remote.state).toBe("active");
    expect(broker.harness.composio.instances.size).toBe(1);
  });
});

describe("appEventCatalog", () => {
  it("lists events only for connected apps the bot may use", async () => {
    const slack = broker.account(owner.userId, "slack");
    connected.slack = { connected: true, accounts: [{ id: slack, status: "ACTIVE" }] };
    const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
    const everything = await appEventCatalog({ broker: client, connected, bot: {} });
    expect(everything.apps.map((app) => app.app)).toEqual(["gmail", "slack"]);
    expect(everything.apps[0]!.events.map((event) => event.event)).toEqual(["GMAIL_NEW_GMAIL_MESSAGE", "GMAIL_EMAIL_SENT"]);
    expect(everything.apps[0]!.events[0]).toMatchObject({ delivery: "poll", filterFields: ["sender", "subject"] });
    const gmailOnly = await appEventCatalog({ broker: client, connected, bot: { connectorTools: { gmail: { tools: "*" } } } });
    expect(gmailOnly.apps.map((app) => app.app)).toEqual(["gmail"]);
    const scoped = await appEventCatalog({ broker: client, connected, bot: { connectorScopes: { apps: { slack: "read" } } } });
    expect(scoped.apps.map((app) => app.app)).toEqual(["slack"]);
    expect((await appEventCatalog({ broker: client, connected, bot: { composio: false } })).apps).toEqual([]);
    expect(everything.notConnected.map((app) => app.app)).not.toContain("gmail");
  });
});

describe("createAppTriggerHost", () => {
  it("refuses a guest-driven Cloud turn and an app outside the bot's grants; otherwise applies with one receipt and Undo", async () => {
    const { createAppTriggerHost } = await import("./app-trigger-host.ts");
    const messages = new Map<string, Array<{ id: string; card?: any }>>();
    const bots: Record<string, any> = {
      scout: { id: "scout", name: "Scout", color: "#000" },
      narrow: { id: "narrow", name: "Narrow", color: "#000", connectorTools: { slack: { tools: "*" } } },
    };
    const host = createAppTriggerHost({
      file: join(dir, "host-app-triggers.json"),
      store: {
        bot: (id) => bots[id],
        messagesFor: (threadId) => messages.get(threadId) ?? [],
        appendMessage: (threadId, message) => {
          const line = { id: `m${(messages.get(threadId)?.length ?? 0) + 1}`, ...message };
          messages.set(threadId, [...(messages.get(threadId) ?? []), line]);
          return line;
        },
        patchMessage: (threadId, messageId, patch) => {
          const line = messages.get(threadId)?.find((candidate) => candidate.id === messageId);
          if (line) Object.assign(line, patch);
          return line;
        },
      },
      connectionMode: () => "managed",
      access: () => ({ url: broker.url, token: owner.token }),
      connectedApps: async () => connected,
      routines: () => routines,
      webhooks: { list: () => [] } as never,
      webhookBase: () => "http://127.0.0.1:8800",
      botState: () => "ready",
      timeZone: () => "UTC",
      visibleBot: () => true,
      emit: () => {},
      audit: () => {},
    });
    const answers: Array<{ status: number; body: any }> = [];
    const json = ((_res: unknown, status: number, body: unknown) => { answers.push({ status, body }); }) as never;
    const operation = { action: "create", trigger: { name: "Acme", instructions: "Draft a reply.", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", filter: { from: "acme.com" } } };
    const context = (from: any, guestDriven = false) => ({ from, threadId: "thread-1", ownsThread: () => true, guestDriven, outsideDriven: () => false, canCommit: () => true });
    await host.submit({} as never, json, { ...context(bots.scout, true), operation });
    expect(answers.at(-1)).toMatchObject({ status: 403, body: { error: expect.stringContaining("Only the Cloud's owner") } });
    await host.submit({} as never, json, { ...context(bots.narrow), operation });
    expect(answers.at(-1)).toMatchObject({ status: 403, body: { error: expect.stringContaining("Narrow has not been given access to Gmail") } });
    expect(host.manager.list()).toEqual([]);
    await host.submit({} as never, json, { ...context(bots.scout), operation });
    expect(answers.at(-1)).toMatchObject({ status: 201, body: { state: "applied", action: "create" } });
    const card = messages.get("thread-1")!.at(-1)!.card;
    expect(card).toMatchObject({ autoApplied: true, answered: "allow", tool: "create_trigger", appTriggerRequest: { operation: { action: "create" } } });
    expect(card.subtitle).toBe("When an email arrives in Gmail (sales) from acme.com (it checks every 15 minutes), Scout follows: Draft a reply.");
    const id = card.appTriggerRequest.resultId as string;
    await host.submit({} as never, json, { ...context(bots.scout), operation: { action: "update", triggerId: id, changes: { filter: { from: "globex.com" } } } });
    const updateCard = messages.get("thread-1")!.at(-1)!.card;
    expect(host.manager.get(id)?.config).toEqual({ query: "from:globex.com" });
    // An event arriving later does not count as a change, so Undo still applies.
    await broker.deliver(host.manager.get(id)!.remote.triggerId!, { subject: "Hello" });
    while (await host.manager.pollOnce(undefined, 0) > 0) { /* drain */ }
    expect(await host.undo({ botId: "scout", threadId: "thread-1", requestId: updateCard.requestId })).toMatchObject({ state: "undone", action: "update" });
    expect(host.manager.get(id)).toMatchObject({ filter: { from: "acme.com" }, config: { query: "from:acme.com" } });
    expect(await host.undo({ botId: "scout", threadId: "thread-1", requestId: card.requestId })).toMatchObject({ state: "undone", action: "create" });
    expect(host.manager.list()).toEqual([]);
    expect(broker.harness.composio.instances.size).toBe(0);
  });
});

describe("instructions in the person's words", () => {
  it("tells the bot to write plain actions, and tells each run where its event is", async () => {
    const { TRIGGER_PROMPT } = await import("./system-prompt.ts");
    const { availableTools, catalogProfileFromEnv } = await import("./drivers/agents-catalog.ts");
    const { eventPrompt } = await import("./app-events.ts");
    expect(TRIGGER_PROMPT).toContain('in the plain words the person would use ("draft a reply", "add the lead to the sheet"): never "event data", "payload", "webhook" or "trigger"');
    const create = availableTools(catalogProfileFromEnv({})).find((tool) => tool.name === "trigger")!;
    expect(create.description).toContain("write name and instructions as they would say them");
    expect((create.inputSchema.properties as Record<string, { description?: string }>).instructions!.description)
      .toContain("in the person's plain words (\"draft a reply\"), never \"event data\", \"payload\", \"webhook\" or \"trigger\"");
    expect(eventPrompt("Draft a reply.", "[UNTRUSTED APP EVENT DATA]\n{}\n[/UNTRUSTED APP EVENT DATA]"))
      .toContain("The email, message or record these instructions mean is in the UNTRUSTED APP EVENT DATA below.");
  });
});

describe("automations made before the owner kept the managed service out", () => {
  type Service = ReturnType<AppTriggerManagerOptions["service"]>;

  function spied() {
    let service: Service = { available: true };
    const fetches: string[] = [];
    const triggers = manager({
      service: () => service,
      broker: brokerClient(() => ({ url: broker.url, token: owner.token }), (input, init) => {
        fetches.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
        return fetch(input, init);
      }),
    });
    return { triggers, fetches, setService: (next: Service) => { service = next; fetches.length = 0; } };
  }

  it.each(["self-hosted", "off"] as const)("%s: pausing, deleting, restoring and syncing change this server's copy and call nothing", async (reason) => {
    const { triggers, fetches, setService } = spied();
    const trigger = await gmailTrigger(triggers);
    const copy = trigger.remote.triggerId!;
    setService({ available: false, reason });

    expect(await triggers.update(trigger.id, { enabled: false })).toMatchObject({ enabled: false, remote: { triggerId: copy, state: "active" } });
    expect(await triggers.update(trigger.id, { restoreConfig: { query: "from:other.com" } })).toMatchObject({ config: { query: "from:other.com" }, remote: { state: "pending" } });
    await triggers.reconcile();
    expect(await triggers.remove(trigger.id)).toBe(true);
    expect(triggers.get(trigger.id)).toBeNull();
    const restored = await triggers.restore(trigger.id);
    expect(restored).toMatchObject({ id: trigger.id, remote: { state: "pending" } });
    expect(restored?.remote.triggerId).toBeUndefined();
    await triggers.reconcile();
    expect(fetches).toEqual([]);
    await expect(triggers.create({ botId: "bot-1", name: "New", prompt: "Tell me.", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" })).rejects.toMatchObject({ status: 409 });
    expect(fetches).toEqual([]);
    expect(triggers.snapshot().service).toEqual({ available: false, reason });
  });

  it("when the managed service comes back, the automation is made again and the old copy is removed", async () => {
    const { triggers, fetches, setService } = spied();
    const trigger = await gmailTrigger(triggers);
    const copy = trigger.remote.triggerId!;
    setService({ available: false, reason: "self-hosted" });
    await triggers.update(trigger.id, { restoreConfig: { query: "from:other.com" } });
    setService({ available: true });
    await triggers.reconcile();
    expect(triggers.get(trigger.id)).toMatchObject({ remote: { state: "active" } });
    expect(triggers.get(trigger.id)?.remote.triggerId).not.toBe(copy);
    expect(fetches).toContain(`DELETE /v1/triggers/${encodeURIComponent(copy)}`);
  });

  it("with no key and no switch, a service not reached yet still gets the calls, and a failed delete is retried", async () => {
    const { triggers, fetches, setService } = spied();
    const trigger = await gmailTrigger(triggers);
    const copy = trigger.remote.triggerId!;
    setService({ available: false, reason: "unavailable" });
    await triggers.update(trigger.id, { enabled: false });
    expect(fetches).toEqual([`PATCH /v1/triggers/${encodeURIComponent(copy)}`]);
    fetches.length = 0;
    await triggers.remove(trigger.id);
    expect(fetches).toEqual([`DELETE /v1/triggers/${encodeURIComponent(copy)}`]);
    fetches.length = 0;
    const restored = await triggers.restore(trigger.id);
    expect(fetches).toContain("POST /v1/triggers");
    expect(restored?.remote.state).toBe("active");
  });

  it("the host reports the switch as off, for the app and for a bot's event list, and calls nothing", async () => {
    vi.stubEnv("OMB_COMPOSIO_BROKER", "off");
    try {
      const { createAppTriggerHost } = await import("./app-trigger-host.ts");
      const fetches = vi.fn();
      const host = createAppTriggerHost({
        file: join(dir, "off-app-triggers.json"),
        store: { bot: () => undefined } as never,
        connectionMode: () => "unavailable", access: () => ({ url: broker.url, token: owner.token }),
        connectedApps: async () => connected, routines: () => routines, webhooks: { list: () => [] } as never,
        webhookBase: () => "http://127.0.0.1:8800", botState: () => "ready", timeZone: () => "UTC", visibleBot: () => true,
        emit: () => {}, audit: () => {}, broker: brokerClient(() => null, fetches as unknown as typeof fetch),
      });
      expect(host.manager.service()).toEqual({ available: false, reason: "off" });
      await host.manager.reconcile();
      expect(fetches).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("app-event automation that keeps one conversation", () => {
  it("saves the option, hands it to each run, and turns it off again", async () => {
    const triggers = manager();
    const trigger = await triggers.create({ botId: "bot-1", name: "Order replies", prompt: "Draft a reply.", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", sameConversation: true });
    expect(trigger.sameConversation).toBe(true);
    await broker.deliver(trigger.remote.triggerId!, { subject: "Order #1" }, "msg_same_1");
    await drain(triggers);
    expect(runsOf(trigger.id)[0]).toMatchObject({ eventSource: "app", sameConversation: true });
    expect(manager().get(trigger.id)?.sameConversation).toBe(true);

    expect(await triggers.update(trigger.id, { sameConversation: false })).not.toHaveProperty("sameConversation");
    routines.cancelQueuedWebhook(trigger.id, "test");
    await broker.deliver(trigger.remote.triggerId!, { subject: "Order #2" }, "msg_same_2");
    await drain(triggers);
    expect(runsOf(trigger.id)[0]).toMatchObject({ deliveryId: "msg_same_2", status: "queued" });
    expect(runsOf(trigger.id)[0]).not.toHaveProperty("sameConversation");
  });
});
