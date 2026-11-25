import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { archiveHeldAppEvents } from "./archive-held-app-events.mjs";
import { brokerClient } from "../server/app-trigger-broker.ts";
import { AppTriggerManager } from "../server/app-triggers.ts";
import { RoutineManager } from "../server/routines.ts";
import { startBrokerFake } from "../server/testing/broker-fake.ts";

let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

it.skipIf(process.platform === "win32")("archives 100 held events privately and rejects a real broker replay while allowing the next hold", async () => {
  root = mkdtempSync(join(tmpdir(), "held-archive-fixture-"));
  const profile = join(root, "profile"), workspace = join(root, "workspace"), output = join(root, "recovery"), archive = join(root, "private");
  mkdirSync(profile); mkdirSync(workspace);
  const broker = await startBrokerFake();
  const owner = await broker.install();
  const gmail = broker.account(owner.userId, "gmail", "fixture");
  const client = brokerClient(() => ({ url: broker.url, token: owner.token }));
  const routines = new RoutineManager({ file: join(root, "routines.json"), botState: () => "busy", createTask: () => ({ threadId: "fixture-run" }), startTurn: async () => {} });
  const makeManager = (folder: string) => new AppTriggerManager({
    file: join(folder, "app-triggers.json"), broker: client, linkedBots: (a, b) => a !== b,
    service: () => ({ available: true }), acknowledgmentScope: () => owner.id,
    connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: gmail, status: "ACTIVE" }] } }), botState: () => "ready",
    runs: { enqueue: input => routines.enqueueWebhook(input), merge: (id, event, same, merge) => routines.mergeIntoQueuedRun(id, event, same, merge),
      receipt: (id, event) => routines.webhookRunReceipt(id, event), eventRecipients: event => routines.appEventRecipients(event),
      pending: id => routines.activeWebhookRunCount(id), cancelQueued: (id, message) => routines.cancelQueuedWebhook(id, message) }, log: () => {},
  });
  try {
    const manager = makeManager(profile);
    const first = await manager.create({ botId: "source", name: "Fixture", prompt: "First", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    await manager.create({ botId: "target", name: "Fixture", prompt: "Second", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    await broker.deliver(first.remote.triggerId!, { fixture: "PRIVATE_SYNTHETIC_PAYLOAD" }, "fixture-held-original");
    await manager.pollOnce(undefined, 0);
    const ledgerPath = join(profile, "app-triggers.json"), heldPath = `${ledgerPath}.held`;
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const held = JSON.parse(readFileSync(heldPath, "utf8"));
    expect(held.events).toHaveLength(1);
    const template = held.events[0];
    for (let seq = 2; seq <= 100; seq++) held.events.push({ ...structuredClone(template), id: `fixture-held-${seq}`, event: { ...structuredClone(template.event), id: `fixture-held-${seq}`, seq } });
    ledger.cursor = 100;
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    writeFileSync(heldPath, JSON.stringify(held));
    const beforeLedger = readFileSync(ledgerPath), beforeHeld = readFileSync(heldPath);
    const result = await archiveHeldAppEvents(profile, workspace, output, archive);
    expect(result.archived).toBe(100);
    expect(readFileSync(ledgerPath)).toEqual(beforeLedger);
    expect(readFileSync(heldPath)).toEqual(beforeHeld);
    expect(readFileSync(join(archive, "app-triggers.json.held"))).toEqual(beforeHeld);
    if (process.platform !== "win32") expect(statSync(join(archive, "app-triggers.json.held")).mode & 0o777).toBe(0o600);
    const rewritten = JSON.parse(readFileSync(join(output, "app-triggers.json.held"), "utf8"));
    expect(rewritten.events).toHaveLength(100);
    expect(rewritten.events.every((row: { discarded: boolean }) => row.discarded)).toBe(true);
    expect(JSON.stringify(rewritten)).not.toContain("PRIVATE_SYNTHETIC_PAYLOAD");
    const originalPoll = await client.poll({ after: 0, waitS: 0, poller: ledger.pollerId });
    expect(originalPoll.events.map(event => event.id)).toContain("fixture-held-original");
    const recovered = makeManager(output);
    recovered.receive(originalPoll.events, 100, owner.id);
    expect(routines.listRuns()).toHaveLength(0);
    const next = { ...template.event, id: "fixture-next-held", seq: 101 };
    recovered.receive([next], 101, owner.id);
    expect(recovered.heldEventReviews()).toHaveLength(1);
    expect(routines.listRuns()).toHaveLength(0);
  } finally { routines.close(); await broker.close(); }
});

it.skipIf(process.platform === "win32")("refuses unsafe paths and unverified or incomplete event stores without modifying the source", async () => {
  root = mkdtempSync(join(tmpdir(), "held-archive-refusal-"));
  const profile = join(root, "profile"), workspace = join(root, "workspace"), output = join(root, "recovery"), archive = join(root, "private");
  mkdirSync(profile); mkdirSync(workspace);
  const ledger = { version: 1, pollerId: "fixture-poller", cursor: 1, triggers: [], heldEvents: [], cursorScope: "owner" };
  const event = { seq: 2, id: "fixture", kind: "message", triggerId: "remote", receivedAt: 1, event: { data: { secret: "PRIVATE_FIXTURE" } } };
  const held = { version: 4, events: [{ id: event.id, reason: "unknown", event, sourceScope: "owner" }] };
  writeFileSync(join(profile, "app-triggers.json"), JSON.stringify(ledger));
  writeFileSync(join(profile, "app-triggers.json.held"), JSON.stringify(held));
  await expect(archiveHeldAppEvents(profile, workspace, output, join(workspace, "unsafe"))).rejects.toThrow(/outside/);
  await expect(archiveHeldAppEvents(profile, workspace, output, archive)).rejects.toThrow(/checkpointed/);
  expect(readFileSync(join(profile, "app-triggers.json.held"), "utf8")).toBe(JSON.stringify(held));
  held.events[0]!.event.seq = 1;
  held.events[0]!.sourceScope = "other";
  writeFileSync(join(profile, "app-triggers.json.held"), JSON.stringify(held));
  await expect(archiveHeldAppEvents(profile, workspace, output, archive)).rejects.toThrow(/verified account/);
});

it.skipIf(process.platform !== "win32")("refuses to create an archive without verified Windows ACL protection", async () => {
  await expect(archiveHeldAppEvents("unused", "unused", "unused", "unused")).rejects.toThrow(/permissions cannot be guaranteed/);
});
