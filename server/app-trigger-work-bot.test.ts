import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AppTriggerBroker } from "./app-trigger-broker.ts";
import { AppTriggerManager } from "./app-triggers.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "linked-app-triggers-"));
  dirs.push(dir);
  let writes = 0;
  let linked = true;
  let bindWait: Promise<void> = Promise.resolve();
  let binding = () => {};
  const pending = new Set<string>();
  const broker: AppTriggerBroker = {
    triggerTypes: async () => ({}),
    triggerType: async () => ({ slug: "SLACK_CHANNEL_MESSAGE_RECEIVED", toolkit: "slack", name: "Message", description: "", config: {}, payload: {} }),
    create: async () => { writes++; binding(); await bindWait; return { triggerId: "remote" }; }, setEnabled: async () => { writes++; }, remove: async () => { writes++; },
    inventory: async () => ({ triggers: [], unbound: [], limits: { plan: "desktop", eventsPerDay: 100 }, usage: { eventsToday: 0 } }),
    poll: async () => ({ events: [], cursor: 0 }), testEvent: async () => {},
  };
  const options = {
    file: join(dir, "triggers.json"), broker, service: () => ({ available: true as const }),
    connectedApps: async () => ({ slack: { connected: true, accounts: [{ id: "account", status: "ACTIVE" }] } }),
    botState: () => "ready" as const,
    linkedOwners: (bot: string) => new Set(!linked ? [] : bot === "source" ? ["target"] : bot === "target" ? ["source"] : []),
    runs: { enqueue: () => ({ id: "run" }), merge: () => null, receipt: () => null, pending: (id: string) => pending.has(id) ? 1 : 0, pendingCounts: () => new Map([...pending].map(id => [id, 1])), cancelQueued: () => {} },
  };
  const manager = new AppTriggerManager(options);
  const create = (botId: string, overrides: { enabled?: boolean; prompt?: string; filter?: { text: string } } = {}) => manager.create({ botId, name: "Synthetic watch", prompt: "Summarize", app: "slack", event: "SLACK_CHANNEL_MESSAGE_RECEIVED", ...overrides });
  return { manager, create, writes: () => writes, reopened: () => new AppTriggerManager(options), setLinked: (value: boolean) => { linked = value; }, waitOnBind: (wait: Promise<void>, onBinding: () => void) => { bindWait = wait; binding = onBinding; }, pending };
}

it.each([["source", "target"], ["target", "source"]])("prevents the same active watch across linked bots (%s first)", async (first, second) => {
  const h = fixture();
  await h.create(first);
  const writes = h.writes();
  await expect(h.create(second)).rejects.toMatchObject({ status: 409 });
  expect(h.writes()).toBe(writes);
  await h.create("independent");
  await expect(h.create(second, { prompt: "Different work" })).rejects.toMatchObject({ status: 409 });
  await expect(h.create(second, { filter: { text: "different filter" } })).rejects.toMatchObject({ status: 409 });
  expect(h.reopened().list()).toHaveLength(2);
});

it("fences handoff while a broker mutation is in flight", async () => {
  const h = fixture();
  h.setLinked(false);
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  h.waitOnBind(wait, entered);
  const pending = h.create("source");
  try {
    await started;
    expect(() => h.manager.assertCanLink("source", "target")).toThrow("automations are changing");
  } finally { release(); }
  await pending;
  expect(() => h.manager.assertCanLink("source", "target")).not.toThrow();
  h.setLinked(true);
  await expect(h.create("target")).rejects.toMatchObject({ status: 409 });
});

it("blocks linking duplicate watches and keeps running deleted work protected", async () => {
  const h = fixture();
  h.setLinked(false);
  const source = await h.create("source");
  const target = await h.create("target");
  expect(() => h.manager.assertCanLink("source", "target")).toThrow("same event");
  await h.manager.remove(target.id);
  h.setLinked(true);
  h.pending.add(source.id);
  await h.manager.remove(source.id);
  await expect(h.create("target")).rejects.toMatchObject({ status: 409 });
  await expect(h.create("target", { prompt: "Different current settings" })).rejects.toMatchObject({ status: 409 });
  h.pending.clear();
  await expect(h.create("target")).rejects.toMatchObject({ status: 409 });
});

it("fails closed when persisted automations cannot be read", () => {
  const h = fixture();
  const file = join(dirs.at(-1)!, "triggers.json");
  writeFileSync(file, "{broken");
  expect(() => h.reopened().assertCanLink("source", "target")).toThrow();
});

it("serializes concurrent creation and protects resume, edits and restore", async () => {
  const h = fixture();
  const results = await Promise.allSettled([h.create("source"), h.create("target")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const active = h.manager.list()[0]!;
  const other = active.botId === "source" ? "target" : "source";
  const paused = await h.create(other, { enabled: false });
  const writes = h.writes();
  await expect(h.manager.update(paused.id, { enabled: true })).rejects.toMatchObject({ status: 409 });
  expect(h.writes()).toBe(writes);
  await h.manager.update(paused.id, { name: "Renamed" });
  await h.manager.remove(active.id);
  await expect(h.manager.update(paused.id, { enabled: true })).rejects.toMatchObject({ status: 409 });
  const beforeRestore = h.writes();
  await expect(h.manager.restore(active.id)).rejects.toMatchObject({ status: 409 });
  expect(h.writes()).toBe(beforeRestore);
  expect(h.reopened().list().find(trigger => trigger.id === paused.id)?.enabled).toBe(false);
});

it("protects pending disabled or deleted work only while another group has work", async () => {
  const h = fixture();
  h.setLinked(false);
  const disabled = await h.create("source", { enabled: false, prompt: "A synthetic watch" });
  const other = await h.create("target", { prompt: "An unrelated synthetic watch" });
  expect(() => h.manager.assertCanLink("source", "target")).toThrow("same event");
  h.pending.add(disabled.id);
  expect(() => h.manager.assertCanLink("source", "target")).toThrow("same event");
  await h.manager.remove(disabled.id);
  expect(() => h.manager.assertCanLink("source", "target")).toThrow("same event");
  await h.manager.remove(other.id);
  expect(() => h.manager.assertCanLink("source", "target")).toThrow("same event");
});

it("does not reassign a queued event when the previous watch is paused", async () => {
  const h = fixture();
  const source = await h.create("source");
  const target = await h.create("target", { enabled: false });
  await h.manager.update(source.id, { enabled: false });
  await expect(h.manager.update(target.id, { enabled: true })).rejects.toMatchObject({ status: 409 });
  expect(h.reopened().list().filter(trigger => trigger.enabled)).toHaveLength(0);
});


it("holds test admission while a broker mutation is unfinished", async () => {
  const h = fixture();
  h.setLinked(false);
  const source = await h.create("source");
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  h.waitOnBind(wait, entered);
  const changing = h.create("target", { prompt: "Independent fixture" });
  try {
    await started;
    await expect(h.manager.runNow(source.id)).rejects.toMatchObject({ status: 409 });
  } finally { release(); }
  await changing;
});
