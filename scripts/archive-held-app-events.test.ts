import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { archiveHeldAppEvents } from "./archive-held-app-events.mjs";
import { brokerClient } from "../server/app-trigger-broker.ts";
import { retiredEventKey } from "../server/app-trigger-file.ts";
import { checkDataFormat } from "../server/data-format.ts";
import { AppTriggerManager } from "../server/app-triggers.ts";
import { RoutineManager } from "../server/routines.ts";
import { startBrokerFake } from "../server/testing/broker-fake.ts";

let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
function protectFixtureParent(folder: string) {
  if (process.platform !== "win32") return;
  const executable = join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const setup = "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetOwner($sid); $a.SetAccessRuleProtection($true,$false); $r=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit, ObjectInherit','None','Allow'); $a.AddAccessRule($r); [System.IO.Directory]::SetAccessControl($env:ARCHIVE_FIXTURE_PATH,$a)";
  execFileSync(executable, ["-NoProfile", "-NonInteractive", "-Command", setup], { env: { ...process.env, ARCHIVE_FIXTURE_PATH: folder }, windowsHide: true });
}

it("archives 100 held events privately and rejects a real broker replay while allowing the next hold", async () => {
  root = mkdtempSync(join(tmpdir(), "held-archive-fixture-"));
  protectFixtureParent(root);
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
    expect(ledger.triggers.find((row: { id: string }) => row.id === first.id).problem?.kind).toBe("error");
    ledger.triggers.find((row: { botId: string }) => row.botId === "target").problem = { kind: "reconnect", at: 100 };
    ledger.heldEvents = held.events.map((row: { id: string }) => row.id);
    writeFileSync(ledgerPath, JSON.stringify({ ...ledger, heldEvents: ledger.heldEvents.slice(0, -1) }));
    writeFileSync(heldPath, JSON.stringify(held));
    await expect(archiveHeldAppEvents(profile, workspace, join(root, "orphan-recovery"), join(root, "orphan-archive"))).rejects.toThrow(/does not match/);
    writeFileSync(ledgerPath, JSON.stringify({ ...ledger, heldEvents: [...ledger.heldEvents, ledger.heldEvents[0]] }));
    await expect(archiveHeldAppEvents(profile, workspace, join(root, "duplicate-recovery"), join(root, "duplicate-archive"))).rejects.toThrow(/does not match/);
    writeFileSync(ledgerPath, JSON.stringify({ ...ledger, version: 2, retiredReceipts: { [retiredEventKey(owner.id, template.id)]: "f".repeat(64) } }));
    writeFileSync(join(profile, "data-format.json"), JSON.stringify({ format: 2 }));
    await expect(archiveHeldAppEvents(profile, workspace, join(root, "conflict-recovery"), join(root, "conflict-archive"))).rejects.toThrow(/conflicts/);
    rmSync(join(profile, "data-format.json"));
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    writeFileSync(heldPath, JSON.stringify(held));
    const beforeLedger = readFileSync(ledgerPath), beforeHeld = readFileSync(heldPath);
    if (process.platform !== "win32") {
      symlinkSync(join(workspace, "unrelated"), join(profile, "unsafe-link"));
      await expect(archiveHeldAppEvents(profile, workspace, join(root, "link-output"), join(root, "link-archive"))).rejects.toThrow(/link or special/);
      rmSync(join(profile, "unsafe-link"));
    }
    const failedOutput = join(root, "copy-failure-output");
    await expect(archiveHeldAppEvents(profile, workspace, failedOutput, join(root, "copy-failure-archive"), async () => { throw Error("synthetic disk full"); })).rejects.toThrow(/could not be completed/);
    expect(existsSync(failedOutput)).toBe(false);
    const incomplete = readdirSync(root).find(name => name.startsWith(".startupbot-recovery-incomplete-"))!;
    expect(incomplete).toBeTruthy();
    expect(() => checkDataFormat(join(root, incomplete), "old", 1, 1)).toThrow();
    expect(() => checkDataFormat(join(root, incomplete), "current", 2, 1)).toThrow();
    expect(readFileSync(ledgerPath)).toEqual(beforeLedger);
    if (process.platform === "win32") {
      const originalRoot = process.env.SystemRoot!;
      const failedArchive = join(root, "failed-private");
      try {
        process.env.SystemRoot = join(root, "no-security-service");
        await expect(archiveHeldAppEvents(profile, workspace, join(root, "failed-output"), failedArchive)).rejects.toThrow(/ACL could not be established/);
        expect(existsSync(failedArchive)).toBe(false);
      } finally { process.env.SystemRoot = originalRoot; }
    }
    const result = await archiveHeldAppEvents(profile, workspace, output, archive);
    expect(result.archived).toBe(100);
    expect(readFileSync(ledgerPath)).toEqual(beforeLedger);
    expect(readFileSync(heldPath)).toEqual(beforeHeld);
    expect(readFileSync(join(archive, "app-triggers.json.held"))).toEqual(beforeHeld);
    expect(readFileSync(join(archive, "app-triggers.json"))).toEqual(beforeLedger);
    const recoveredLedger = JSON.parse(readFileSync(join(output, "app-triggers.json"), "utf8"));
    expect(JSON.parse(readFileSync(join(output, "data-format.json"), "utf8")).format).toBe(2);
    expect(() => checkDataFormat(output, "old", 1, 1)).toThrow();
    expect(() => checkDataFormat(output, "current", 2, 1)).not.toThrow();
    expect(recoveredLedger.version).toBe(2);
    expect(recoveredLedger.heldEvents).toEqual([]);
    expect(Object.keys(recoveredLedger.retiredReceipts)).toHaveLength(100);
    expect(recoveredLedger.attempts).toEqual(ledger.attempts);
    expect(recoveredLedger.triggers.find((row: { id: string }) => row.id === first.id).problem).toBeUndefined();
    expect(recoveredLedger.triggers.find((row: { botId: string }) => row.botId === "target").problem).toEqual({ kind: "reconnect", at: 100 });
    if (process.platform !== "win32") expect(statSync(join(archive, "app-triggers.json.held")).mode & 0o777).toBe(0o600);
    else {
      const windowsPowerShell = join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const check = "$a=[System.IO.Directory]::GetAccessControl($env:ARCHIVE_FIXTURE_PATH); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); if (!$a.AreAccessRulesProtected -or $r.Count -ne 1 -or $r[0].IdentityReference.Value -ne $sid -or $r[0].IsInherited) { exit 1 }";
      const runCheck = () => execFileSync(windowsPowerShell, ["-NoProfile", "-NonInteractive", "-Command", check], { env: { ...process.env, ARCHIVE_FIXTURE_PATH: archive }, windowsHide: true });
      runCheck();
      execFileSync("icacls.exe", [root, "/grant", "*S-1-1-0:(OI)(CI)(RX)"], { stdio: "ignore", windowsHide: true });
      runCheck();
    }
    const rewritten = JSON.parse(readFileSync(join(output, "app-triggers.json.held"), "utf8"));
    expect(rewritten.events).toEqual([]);
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

it("refuses unsafe paths and unverified or incomplete event stores without modifying the source", async () => {
  root = mkdtempSync(join(tmpdir(), "held-archive-refusal-"));
  protectFixtureParent(root);
  const profile = join(root, "profile"), workspace = join(root, "workspace"), output = join(root, "recovery"), archive = join(root, "private");
  mkdirSync(profile); mkdirSync(workspace);
  const ledger = { version: 1, pollerId: "fixture-poller", cursor: 1, triggers: [], heldEvents: ["fixture"], cursorScope: "owner" };
  const event = { seq: 2, id: "fixture", kind: "message", triggerId: "remote", receivedAt: 1, event: { data: { secret: "PRIVATE_FIXTURE" } } };
  const held = { version: 4, events: [{ id: event.id, reason: "unknown", event, sourceScope: "owner" }] };
  writeFileSync(join(profile, "app-triggers.json"), JSON.stringify(ledger));
  writeFileSync(join(profile, "app-triggers.json.held"), JSON.stringify(held));
  await expect(archiveHeldAppEvents(profile, workspace, output, join(workspace, "unsafe"))).rejects.toThrow(/outside/);
  if (process.platform !== "win32") {
    const shared = join(root, "shared");
    mkdirSync(shared); chmodSync(shared, 0o777);
    await expect(archiveHeldAppEvents(profile, workspace, output, join(shared, "unsafe"))).rejects.toThrow(/shared or writable/);
  }
  await expect(archiveHeldAppEvents(profile, workspace, output, archive)).rejects.toThrow(/checkpointed/);
  expect(readFileSync(join(profile, "app-triggers.json.held"), "utf8")).toBe(JSON.stringify(held));
  held.events[0]!.event.seq = 1;
  held.events[0]!.sourceScope = "other";
  writeFileSync(join(profile, "app-triggers.json.held"), JSON.stringify(held));
  await expect(archiveHeldAppEvents(profile, workspace, output, archive)).rejects.toThrow(/verified account/);
  held.events[0]!.sourceScope = "owner";
  held.events[0]!.event.seq = 0;
  writeFileSync(join(profile, "app-triggers.json.held"), JSON.stringify(held));
  await expect(archiveHeldAppEvents(profile, workspace, output, archive)).rejects.toThrow(/checkpointed/);
});

it("archives a store already over the byte limit and converts every receipt without losing payloads", async () => {
  root = mkdtempSync(join(tmpdir(), "held-archive-full-"));
  protectFixtureParent(root);
  const profile = join(root, "profile"), workspace = join(root, "workspace"), output = join(root, "recovery"), archive = join(root, "private");
  mkdirSync(profile); mkdirSync(workspace);
  const ledger = { version: 1, pollerId: "fixture-poller", cursor: 1, triggers: [], heldEvents: [] as string[], cursorScope: "owner" };
  const payload = { seq: 1, id: "fixture-active", kind: "message", triggerId: "remote", receivedAt: 1, event: { data: { secret: "PRIVATE_FIXTURE" } } };
  const events = Array.from({ length: 12_000 }, (_, i) => ({ id: `fixture-receipt-${i}`, reason: "unknown", sourceScope: "owner", discarded: true,
    eventDigest: "a".repeat(64), event: { ...payload, id: `fixture-receipt-${i}`, event: {} } }));
  events.push({ id: payload.id, reason: "unknown", sourceScope: "owner", event: payload } as typeof events[number]);
  ledger.heldEvents = events.map(row => row.id);
  const contents = JSON.stringify({ version: 4, events });
  expect(Buffer.byteLength(contents)).toBeGreaterThan(2_000_000);
  writeFileSync(join(profile, "app-triggers.json"), JSON.stringify(ledger));
  writeFileSync(join(profile, "app-triggers.json.held"), contents);
  await expect(archiveHeldAppEvents(profile, workspace, output, archive)).resolves.toMatchObject({ archived: 12_001 });
  expect(readFileSync(join(profile, "app-triggers.json.held"), "utf8")).toBe(contents);
  expect(readFileSync(join(archive, "app-triggers.json.held"), "utf8")).toBe(contents);
  const recovered = JSON.parse(readFileSync(join(output, "app-triggers.json"), "utf8"));
  expect(Object.keys(recovered.retiredReceipts)).toHaveLength(12_001);
  expect(JSON.parse(readFileSync(join(output, "app-triggers.json.held"), "utf8")).events).toEqual([]);
  const tombstones = events.slice(0, -1);
  const priorKey = retiredEventKey("owner", "older-fixture");
  const onlyReceipts = { ...ledger, version: 2, heldEvents: tombstones.map(row => row.id), retiredReceipts: { [priorKey]: "b".repeat(64) } };
  writeFileSync(join(profile, "app-triggers.json"), JSON.stringify(onlyReceipts));
  writeFileSync(join(profile, "data-format.json"), JSON.stringify({ format: 2 }));
  writeFileSync(join(profile, "app-triggers.json.held"), JSON.stringify({ version: 4, events: tombstones }));
  const secondOutput = join(root, "recovery-only-receipts"), secondArchive = join(root, "private-only-receipts");
  await expect(archiveHeldAppEvents(profile, workspace, secondOutput, secondArchive)).resolves.toMatchObject({ archived: 12_000 });
  const again = JSON.parse(readFileSync(join(secondOutput, "app-triggers.json"), "utf8"));
  expect(again.retiredReceipts[priorKey]).toBe("b".repeat(64));
  expect(Object.keys(again.retiredReceipts)).toHaveLength(12_001);
});
