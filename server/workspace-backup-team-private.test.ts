import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { retiredEventKey } from "./app-trigger-file.ts";
import { readBlockedAppEventRestore, recordBlockedAppEventRestore } from "./workspace-backup-app-events.ts";
import { CLOUD_OUTSIDE_KEY } from "./cloud-sharing.ts";
import { openRuntimeStore } from "./runtime/store.ts";
import type { Assignment } from "./runtime/types.ts";
import { applyPendingWorkspaceRestore, commitPendingWorkspaceRestore, createWorkspaceBackupSnapshot, readPendingWorkspaceRestoreMetadata, stagedWorkspaceData, stageWorkspaceBackup } from "./workspace-backup.ts";
import { WORK_BOT_UPLOAD_RECEIPTS_SCHEMA } from "./work-bot-upload-receipts.ts";
import { ensureMemoryIndex } from "./message-db-memory-index.ts";
import { omittedAsTeamPrivate, routinesWithoutTeamPrivate, stripTeamPrivate, TEAM_PRIVATE_NOTE, teamAppEventLedger, teamPrivateAttachments, teamPrivateThreads, withoutTeamPrivate } from "./workspace-backup-team-private.ts";

const BOB = "p_bobbobbobbobbobbobbob1";
const PASSWORD = "correct horse battery staple";
const scratch: string[] = [];
const envBefore = process.env.OMB_CLOUD_ROLE;
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
  if (envBefore === undefined) delete process.env.OMB_CLOUD_ROLE; else process.env.OMB_CLOUD_ROLE = envBefore;
});
const directory = () => { const path = mkdtempSync(join(tmpdir(), "omb-team-export-")); scratch.push(path); return path; };
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const file = (path: string, text = "x") => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };

const assignment = (id: string, threadId: string): Assignment => ({
  id, rootId: id, depth: 0, origin: { kind: "person", source: "chat", quote: "Ship it" }, requester: { kind: "person", threadId },
  assignee: { botId: "bot", destination: { kind: "standing_thread", threadId: `${threadId}-work` } }, mode: "work", reply: "resume", brief: "Ship it",
  status: "completed", outcome: "done", level: "ask", levelSource: "own", executions: 1, restarts: 0, createdAt: 1_000, lastActivityAt: 2_000, finishedAt: 2_000, result: "Built", rework: false, version: 1,
});

/** A Team Cloud's data folder: Bob's private chat with the bot, the bot's main chat, a room, and what each leaves behind. */
function teamData(root: string): void {
  json(join(root, "thread-starters.json"), { "bob-chat": BOB, "room-thread": BOB, "outside-thread": CLOUD_OUTSIDE_KEY });
  json(join(root, "groups.json"), [{ id: "room", threadId: "room-thread", memberIds: ["bot"], tasks: [{ threadId: "room-thread" }] }]);
  json(join(root, "bots.json"), [{ id: "bot", name: "Scout", threadId: "main", avatarUrl: "/api/attachments/avatar.png", tasks: [{ threadId: "main", title: "Scout" }, { threadId: "bob-chat", title: "Bob's" }, { threadId: "outside-thread", title: "Webhook" }] },
    { id: "bobs-own", name: "StartupBot", threadId: "bobs-own-main", defaultBot: { person: "bob@acme.test" }, tasks: [{ threadId: "bobs-own-main", title: "StartupBot" }, { threadId: "bobs-inbox", title: "Inbox" }] }]);
  json(join(root, "person-inbox.json"), { items: [{ text: "Bob's inbox line" }] });
  file(join(root, "workspaces", "bobs-own", "MEMORY.md"), "Bob's own bot's notes");
  json(join(root, "config.json"), { language: "en" });
  for (const name of ["bobs.png", "both.png", "unsent.png", "avatar.png", "12345678-1234-4234-8234-123456789abc.pdf", ".openmaus-upload-12345678-1234-4234-8234-123456789abc-12345678-1234-4234-8234-123456789abc.partial", ".openmaus-upload-22345678-1234-4234-8234-123456789abc-32345678-1234-4234-8234-123456789abc.partial"]) file(join(root, "attachments", name));
  file(join(root, "people", BOB, "uploads.json"), JSON.stringify(["unsent.png", "avatar.png"]));
  file(join(root, "workspaces", "bot", "MEMORY.md"), "team notes");
  file(join(root, "workspaces", `bot--member-${BOB}`, "MEMORY.md"), "Bob's notes");
  file(join(root, "workspaces", "bot--room-room", "MEMORY.md"), "room notes");
  file(join(root, "task-workspaces", "bot", "main", "plan.md"), "shared plan");
  file(join(root, "task-workspaces", "bot", "bob-chat", "draft.md"), "Bob's draft");
  file(join(root, "people", BOB, "about.json"), "{\"aboutMe\":\"interviewing elsewhere\"}");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE messages(thread_id TEXT, id TEXT, at INTEGER, role TEXT, kind TEXT, text TEXT, json TEXT, PRIMARY KEY(thread_id,id)); CREATE TABLE thread_state(thread_id TEXT PRIMARY KEY, active_leaf_id TEXT);"
    + " CREATE TABLE chat_followups(id TEXT PRIMARY KEY, kind TEXT, owner_id TEXT, thread_id TEXT, send_id TEXT, status TEXT, payload TEXT);"
    + " CREATE TABLE notification_log(id TEXT PRIMARY KEY, at INTEGER, kind TEXT, bot_id TEXT, bot_name TEXT, thread_id TEXT, group_id TEXT, title TEXT, body TEXT, avatar_url TEXT, for_person TEXT, read INTEGER);");
  db.exec("CREATE TABLE report_sections(thread_id TEXT, source_thread TEXT)");
  db.exec("INSERT INTO report_sections VALUES ('main', 'room-thread'), ('main', 'bob-chat'), ('bob-chat', 'room-thread')");
  db.exec("CREATE TABLE work_bot_links(source_bot_id TEXT, source_thread_id TEXT, source_message_id TEXT, target_bot_id TEXT, target_thread_id TEXT)");
  db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  db.prepare("INSERT INTO work_bot_upload_owners (upload_id, principal) VALUES (?, ?)").run("12345678-1234-4234-8234-123456789abc", "fixture-private-principal");
  db.prepare("INSERT INTO work_bot_upload_reservations (upload_id,receipt_hash) VALUES (?,?)").run("12345678-1234-4234-8234-123456789abc", "a".repeat(64));
  db.prepare("INSERT INTO work_bot_upload_receipts (receipt_hash, principal, stored_name, digest, bytes, thread_id, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run("a".repeat(64), "fixture-private-principal", "12345678-1234-4234-8234-123456789abc.pdf", "b".repeat(64), 1, "bob-chat", "bob-chat-m1");
  db.prepare("INSERT INTO work_bot_message_upload_sets VALUES (?, ?, ?, ?, ?)").run("bob-chat", "bob-chat-m1", "fixture-private-principal", "c".repeat(64), "[]");
  const link = db.prepare("INSERT INTO work_bot_links VALUES (?, ?, ?, ?, ?)");
  link.run("bot", "main", "shared", "bot", "room-thread");
  link.run("bot", "bob-chat", "private-source", "bot", "main");
  link.run("bot", "main", "private-target", "bot", "bobs-inbox");
  link.run("bobs-own", "main", "private-bot", "bot", "room-thread");
  link.run("bot", "main", "private-target-bot", "bobs-own", "room-thread");
  ensureMemoryIndex(db);
  db.exec("CREATE TABLE command_receipts(kind TEXT, key TEXT, at INTEGER, result TEXT, PRIMARY KEY (kind, key))");
  db.prepare("INSERT INTO command_receipts VALUES ('memory', 'k', 1, ?)").run("Bob's receipted secret");
  for (const [bot, text] of [["bot", "team notes"], [`bot--member-${BOB}`, "Bob's noted secret"], ["bobs-own", "Bob's own noted secret"]]) {
    db.prepare("INSERT INTO memory_files(bot_id, path, text, mtime_ms, bytes) VALUES (?, 'MEMORY.md', ?, 1, 1)").run(bot!, text!);
  }
  for (const [thread, text] of [["main", "team question"], ["bob-chat", "Bob's secret"], ["bobs-inbox", "Bob's inbox secret"], ["room-thread", "room talk"], ["outside-thread", "webhook event"]]) {
    const attached = thread === "bob-chat" ? ["attachments/bobs.png", "attachments/both.png"] : thread === "main" ? ["attachments/both.png"] : [];
    db.prepare("INSERT INTO messages VALUES (?, ?, 1, 'user', 'text', ?, ?)").run(thread!, `${thread}-m1`, text!, JSON.stringify({ id: `${thread}-m1`, text, attachments: attached.map((path) => ({ path })) }));
    db.prepare("INSERT INTO thread_state VALUES (?, ?)").run(thread, `${thread}-m1`);
    db.prepare("INSERT INTO chat_followups VALUES (?, 'bot', 'bot', ?, 's', 'pending', ?)").run(`${thread}-f`, thread, JSON.stringify({ text }));
    db.prepare("INSERT INTO notification_log VALUES (?, 1, 'mention', 'bot', 'Scout', ?, NULL, ?, ?, NULL, ?, 0)").run(`${thread}-n`, thread, text, text, BOB);
  }
  db.prepare("UPDATE messages SET json = ? WHERE thread_id = 'main'").run(JSON.stringify({ id: "main-m1", text: "team question", attachments: [{ path: "attachments/both.png" }], workBotRouting: { state: "dispatched", sourceBotId: "bot", targetBotId: "bobs-own", targetThreadId: "bobs-inbox" } }));
  db.prepare("VACUUM INTO ?").run(join(root, "messages.db"));
  db.close();
  const runtime = openRuntimeStore(join(root, "runtime.db"));
  try {
    runtime.insert(assignment("as-team", "main"), { kind: "enqueued", at: 1_000 });
    runtime.insert(assignment("as-bob", "bob-chat"), { kind: "enqueued", at: 1_000 });
  } finally { runtime.close(); }
}

const table = (path: string, sql: string) => { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } };
const textOf = (path: string) => readFileSync(path, "utf8");

async function exported(root: string): Promise<{ data: string; warnings: string[] }> {
  const made = await createWorkspaceBackupSnapshot(root, { password: PASSWORD, appVersion: "test" });
  const destination = directory();
  const staged = await stageWorkspaceBackup(destination, made.path, { password: PASSWORD, currentAppVersion: "test" });
  return { data: stagedWorkspaceData(destination, staged.id).data, warnings: made.summary.warnings };
}

describe("what a Team Cloud's export leaves out (the private sentence: not the Owner, not an admin)", () => {
  it("omits malformed held app events from a version 2 Team export with a warning", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const root = directory();
    teamData(root);
    file(join(root, "app-triggers.json.held"), JSON.stringify({ version: 1, events: [{ id: "fixture", event: { private: "fixture" } }] }));
    const { data, warnings } = await exported(root);
    expect(warnings.some(warning => warning.includes("App automations and their event history are not included"))).toBe(true);
    expect(existsSync(join(data, "app-triggers.json.held"))).toBe(false);
    expect(existsSync(join(root, "app-triggers.json.held"))).toBe(true);
  }, 60_000);

  const retired = {
    id: "fixture-private-event", reason: "conflict", discarded: true, sourceScope: "fixture-scope", eventDigest: "a".repeat(64),
    event: { id: "fixture-private-event", seq: 3, kind: "message", triggerId: "fixture-private-trigger", receivedAt: 1, event: {} },
  };
  const publicTeam = { bots: new Set<string>(), threads: new Set<string>() };
  const attempt = { id: "sample", triggerId: "allowed-trigger", eventId: retired.id, at: 1, outcome: "started", preview: "private fixture preview" };
  const ledger = { version: 1, attempts: [attempt], cursorScope: retired.sourceScope, cursor: 3, pollerId: "test-poller", triggers: [], heldEvents: [retired.id] };

  it("exports Team data without retired event receipts and leaves the original unchanged", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const root = directory();
    teamData(root);
    json(join(root, "app-triggers.json"), ledger);
    const receipts = { version: 4, events: [retired] };
    json(join(root, "app-triggers.json.held"), receipts);
    const scratch = "app-triggers.json.held.1234.12345678-1234-1234-1234-123456789abc.tmp";
    file(join(root, scratch), "private fixture preview");
    const { data, warnings } = await exported(root);
    expect(JSON.parse(textOf(join(data, "..", "manifest.json"))).summary.version).toBe(2);
    expect(warnings.some(warning => warning.includes("App automations and their event history are not included"))).toBe(true);
    expect(existsSync(join(data, "app-triggers.json"))).toBe(false);
    expect(existsSync(join(data, "app-triggers.json.held"))).toBe(false);
    expect(existsSync(join(data, scratch))).toBe(false);
    expect(existsSync(join(root, scratch))).toBe(true);
    expect(textOf(join(root, "app-triggers.json"))).toBe(JSON.stringify(ledger));
    expect(textOf(join(root, "app-triggers.json.held"))).toBe(JSON.stringify(receipts));
  }, 60_000);

  it("keeps ordinary version 1 app automations available to Team backup", () => {
    const normal = { ...ledger, heldEvents: [], attempts: [] };
    expect(teamAppEventLedger(normal, undefined, publicTeam)).toEqual(normal);
    expect(() => teamAppEventLedger({ ...normal, version: 2, retiredReceipts: { ["a".repeat(64)]: "b".repeat(64) } }, undefined, publicTeam)).toThrow(/held app events/);
  });

  it("restores a Team omission while preserving destination retired receipts and its format marker", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const source = directory(); teamData(source);
    json(join(source, "app-triggers.json"), ledger);
    json(join(source, "app-triggers.json.held"), { version: 4, events: [retired] });
    const archive = await createWorkspaceBackupSnapshot(source, { password: PASSWORD, appVersion: "test" });
    expect(archive.summary.version).toBe(2);
    const target = directory();
    const local = { version: 2, cursor: 3, cursorScope: "target-scope", pollerId: "target-poller", triggers: [], attempts: [], heldEvents: [], retiredReceipts: { ["a".repeat(64)]: "b".repeat(64) } };
    json(join(target, "app-triggers.json"), local);
    json(join(target, "data-format.json"), { format: 2, writtenBy: "test", writtenAt: "" });
    const before = textOf(join(target, "app-triggers.json")), marker = textOf(join(target, "data-format.json"));
    const staged = await stageWorkspaceBackup(target, archive.path, { password: PASSWORD });
    recordBlockedAppEventRestore(target, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "earlier fixture");
    commitPendingWorkspaceRestore(target, staged.id);
    expect(applyPendingWorkspaceRestore(target).restored).toBe(true);
    expect(readBlockedAppEventRestore(target)).toBeNull();
    expect(textOf(join(target, "app-triggers.json"))).toBe(before);
    expect(textOf(join(target, "data-format.json"))).toBe(marker);
    expect(existsSync(join(target, "bots.json"))).toBe(true);
  }, 60_000);

  it("cancels a committed Team restore safely if the destination acquires an automation before restart", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const source = directory(); teamData(source);
    json(join(source, "app-triggers.json"), ledger);
    json(join(source, "app-triggers.json.held"), { version: 4, events: [retired] });
    const archive = await createWorkspaceBackupSnapshot(source, { password: PASSWORD, appVersion: "test" });
    const target = directory(); json(join(target, "bots.json"), [{ id: "old-bot" }]);
    const staged = await stageWorkspaceBackup(target, archive.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(target, staged.id);
    const trigger = { id: "fixture", name: "Fixture", prompt: "Fixture", botId: "old-bot", runOn: "maus", enabled: true, app: "gmail", appName: "Gmail", event: "FIXTURE", eventName: "Fixture", delivery: "poll", accountId: "fixture", config: {}, remote: { state: "active", triggerId: "fixture-remote" }, received: 0, filtered: 0, createdAt: 1, updatedAt: 1 };
    const local = { version: 1, cursor: 0, pollerId: "target-poller", triggers: [trigger], attempts: [], heldEvents: [] };
    json(join(target, "app-triggers.json"), local);
    const result = applyPendingWorkspaceRestore(target);
    expect(result).toMatchObject({ restored: false, rolledBack: true, blockedReason: expect.stringMatching(/app automations/) });
    expect(readBlockedAppEventRestore(target)).toEqual(result);
    expect(readPendingWorkspaceRestoreMetadata(target)).toBeNull();
    expect(JSON.parse(textOf(join(target, "bots.json")))).toEqual([{ id: "old-bot" }]);
    expect(JSON.parse(textOf(join(target, "app-triggers.json")))).toEqual(local);
    expect(applyPendingWorkspaceRestore(target)).toEqual({ restored: false });
  }, 60_000);

  it("does not overwrite destination retired receipts with an ordinary version 1 restore", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const source = directory(); teamData(source);
    const archive = await createWorkspaceBackupSnapshot(source, { password: PASSWORD, appVersion: "test" });
    expect(archive.summary.version).toBe(1);
    const target = directory();
    const local = { version: 2, cursor: 3, cursorScope: "target-scope", pollerId: "target-poller", triggers: [], attempts: [], heldEvents: [], retiredReceipts: { ["a".repeat(64)]: "b".repeat(64) } };
    json(join(target, "app-triggers.json"), local);
    const staged = await stageWorkspaceBackup(target, archive.path, { password: PASSWORD });
    expect(() => commitPendingWorkspaceRestore(target, staged.id)).toThrow(/retired app event receipts/);
    expect(readPendingWorkspaceRestoreMetadata(target)).toBeNull();
    expect(JSON.parse(textOf(join(target, "app-triggers.json")))).toEqual(local);
  }, 60_000);

  it("cancels a committed version 1 restore when a retired receipt appears before restart", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const source = directory(); teamData(source);
    const archive = await createWorkspaceBackupSnapshot(source, { password: PASSWORD, appVersion: "test" });
    const target = directory(); json(join(target, "bots.json"), [{ id: "old-bot" }]);
    const staged = await stageWorkspaceBackup(target, archive.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(target, staged.id);
    const local = { version: 2, cursor: 3, cursorScope: "target-scope", pollerId: "target-poller", triggers: [], attempts: [], heldEvents: [], retiredReceipts: { ["a".repeat(64)]: "b".repeat(64) } };
    json(join(target, "app-triggers.json"), local);
    const result = applyPendingWorkspaceRestore(target);
    expect(result).toMatchObject({ restored: false, rolledBack: true, blockedReason: expect.stringMatching(/retired app event receipts/) });
    expect(readBlockedAppEventRestore(target)).toEqual(result);
    expect(readPendingWorkspaceRestoreMetadata(target)).toBeNull();
    expect(JSON.parse(textOf(join(target, "bots.json")))).toEqual([{ id: "old-bot" }]);
    expect(JSON.parse(textOf(join(target, "app-triggers.json")))).toEqual(local);
  }, 60_000);

  it("refuses version 1 private definitions and orphan attempt previews before export", () => {
    const privacy = { bots: new Set(["private-bot"]), threads: new Set(["private-thread"]) };
    const normal = { ...ledger, heldEvents: [], attempts: [], triggers: [{ id: "public-trigger", botId: "public-bot", prompt: "public fixture" }] };
    expect(teamAppEventLedger(normal, undefined, privacy)).toEqual(normal);
    expect(() => teamAppEventLedger({ ...normal, triggers: [{ id: "private-trigger", botId: "private-bot", prompt: "private fixture" }] }, undefined, privacy)).toThrow(/private app automation/);
    expect(() => teamAppEventLedger({ ...normal, deleted: [{ trigger: { id: "private-trigger", botId: "public-bot", sourceThreadId: "private-thread" } }] }, undefined, privacy)).toThrow(/private app automation/);
    expect(() => teamAppEventLedger({ ...normal, attempts: [{ triggerId: "missing", preview: "private fixture" }] }, undefined, privacy)).toThrow(/attempt owners/);
  });

  it("omits a private version 1 automation from the actual Team archive", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const root = directory(); teamData(root);
    const privateLedger = { version: 1, cursor: 0, pollerId: "fixture-poller", heldEvents: [], attempts: [], triggers: [{ id: "private-trigger", botId: "bobs-own", prompt: "PRIVATE_AUTOMATION_FIXTURE" }] };
    json(join(root, "app-triggers.json"), privateLedger);
    const { data, warnings } = await exported(root);
    expect(existsSync(join(data, "app-triggers.json"))).toBe(false);
    expect(warnings.some(warning => warning.includes("App automations and their event history are not included"))).toBe(true);
    expect(textOf(join(root, "app-triggers.json"))).toBe(JSON.stringify(privateLedger));
  }, 60_000);

  it("exports Team data after retirement without copying the version 2 receipt ledger", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const root = directory(); teamData(root);
    const local = { version: 2, cursor: 3, cursorScope: "fixture-scope", pollerId: "fixture-poller", triggers: [], attempts: [], heldEvents: [], retiredReceipts: { ["a".repeat(64)]: "b".repeat(64) } };
    json(join(root, "app-triggers.json"), local);
    json(join(root, "data-format.json"), { format: 2, writtenBy: "test", writtenAt: "" });
    const { data, warnings } = await exported(root);
    expect(JSON.parse(textOf(join(data, "..", "manifest.json"))).summary.version).toBe(2);
    expect(existsSync(join(data, "app-triggers.json"))).toBe(false);
    expect(warnings.some(warning => warning.includes("App automations and their event history are not included"))).toBe(true);
    expect(JSON.parse(textOf(join(root, "app-triggers.json")))).toEqual(local);
  }, 60_000);

  it("rejects a missing, malformed, active, unacknowledged or differently scoped retirement receipt", () => {
    expect(() => teamAppEventLedger(ledger, undefined, publicTeam)).toThrow(/held app events/);
    const sameKey = retiredEventKey(retired.sourceScope, retired.id);
    const inconsistent = { ...ledger, version: 2, retiredReceipts: { [sameKey]: "b".repeat(64) } };
    expect(() => teamAppEventLedger(inconsistent, { version: 4, events: [retired] }, publicTeam)).toThrow(/held app events/);
    const invalid = [
      { ...retired, discarded: undefined }, { ...retired, eventDigest: "invalid" }, { ...retired, sourceScope: "different" },
      { ...retired, event: { ...retired.event, seq: ledger.cursor + 1 } },
      { ...retired, event: { ...retired.event, event: { data: { private: "fixture" } } } },
    ];
    for (const row of invalid) expect(() => teamAppEventLedger(ledger, { version: 4, events: [row] }, publicTeam)).toThrow(/held app events/);
    expect(() => teamAppEventLedger(ledger, { version: 4, events: [retired, { id: "still-held", reason: "unknown" }] }, publicTeam)).toThrow(/held app events/);
  });

  it("omits held payloads in the earlier format from Team export", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const root = directory();
    teamData(root);
    json(join(root, "app-triggers.json"), { version: 1, heldEvents: [{ id: "fixture", event: { private: "fixture" } }] });
    const { data, warnings } = await exported(root);
    expect(existsSync(join(data, "app-triggers.json"))).toBe(false);
    expect(warnings.some(warning => warning.includes("App automations and their event history are not included"))).toBe(true);
    expect(existsSync(join(root, "app-triggers.json"))).toBe(true);
  }, 60_000);
  it("knows the private conversations from who opened them: a member's own chats, never the team's, a room's or an outside marker's", () => {
    const root = directory();
    teamData(root);
    const files = { starters: join(root, "thread-starters.json"), groups: join(root, "groups.json"), bots: join(root, "bots.json") };
    expect(teamPrivateThreads(files, { OMB_CLOUD_ROLE: "home" })).toBeNull();
    const privacy = teamPrivateThreads(files, { OMB_CLOUD_ROLE: "team" })!;
    expect([...privacy.threads].sort()).toEqual(["bob-chat", "bobs-inbox", "bobs-own-main"]);
    expect([...privacy.bots]).toEqual(["bobs-own"]);
    expect(omittedAsTeamPrivate("workspaces/bobs-own/MEMORY.md", privacy)).toBe(true);
    expect(omittedAsTeamPrivate("person-inbox.json", privacy)).toBe(true);
    const attachments = teamPrivateAttachments(root, join(root, "messages.db"), privacy);
    expect([...attachments].sort()).toEqual([".openmaus-upload-12345678-1234-4234-8234-123456789abc-12345678-1234-4234-8234-123456789abc.partial", "12345678-1234-4234-8234-123456789abc.pdf", "bobs.png", "unsent.png"]);
    expect(omittedAsTeamPrivate("attachments/bobs.png", { ...privacy, attachments })).toBe(true);
    expect(omittedAsTeamPrivate("attachments/both.png", { ...privacy, attachments })).toBe(false);
    expect(omittedAsTeamPrivate(`workspaces/bot--member-${BOB}/MEMORY.md`, privacy)).toBe(true);
    expect(omittedAsTeamPrivate("workspaces/bot--room-room/MEMORY.md", privacy)).toBe(false);
    expect(omittedAsTeamPrivate("workspaces/bot/MEMORY.md", privacy)).toBe(false);
    expect(omittedAsTeamPrivate("task-workspaces/bot/bob-chat/draft.md", privacy)).toBe(true);
    expect(omittedAsTeamPrivate("task-workspaces/bot/main/plan.md", privacy)).toBe(false);
    expect(omittedAsTeamPrivate(`people/${BOB}/about.json`, privacy)).toBe(true);
    expect(omittedAsTeamPrivate("peoplesoft/x", privacy)).toBe(false);
    for (const kept of ["events/bob-chat.ndjson", "native/bob-chat.ndjson", `memory-journal/bot--member-${BOB}.ndjson`]) expect(omittedAsTeamPrivate(kept, privacy), kept).toBe(true);
    for (const shared of ["events/main.ndjson", "native/main.ndjson", "memory-journal/bot.ndjson", "memory-journal/bot--room-room.ndjson"]) expect(omittedAsTeamPrivate(shared, privacy), shared).toBe(false);
    expect(withoutTeamPrivate([{ id: "bot", tasks: [{ threadId: "main" }, { threadId: "bob-chat" }] }, { id: "bobs-own", tasks: [] }], privacy)).toEqual([{ id: "bot", tasks: [{ threadId: "main" }] }]);
  });

  it("leaves out the routines that live in a member's private chat and every run that names one", () => {
    const privacy = { threads: new Set(["bob-chat", "bob-results", "bob-run"]), bots: new Set(["bobs-own"]), attachments: new Set<string>() };
    const bots = [{ id: "bot", tasks: [{ threadId: "main", title: "Scout" }, { threadId: "bob-chat", title: "Bob's" }, { threadId: "bob-results", title: "Standup · Results" }] }];
    const routines = { routines: [
      { id: "made-there", botId: "bot", name: "Kumquat", sourceThreadId: "bob-chat" },
      { id: "reports-there", botId: "bot", name: "Quince", resultsThreadId: "bob-chat" },
      { id: "standup", botId: "bot", name: "Standup", resultsThreadId: "bob-results" },
      { id: "own-bot", botId: "bobs-own", name: "Mine" },
    ], runs: [
      { id: "r1", routineId: "made-there", threadId: "other" },
      { id: "r2", routineId: "standup", threadId: "bob-run" },
      { id: "r3", routineId: "standup", threadId: "team-run" },
    ], ownerNotices: [] };
    expect(routinesWithoutTeamPrivate(routines, bots, privacy)).toEqual({ routines: [routines.routines[2]], runs: [routines.runs[2]], ownerNotices: [] });
  });

  it("strips the private conversations' rows from the snapshot databases and rebuilds them, so no freed page keeps their words", () => {
    const root = directory();
    teamData(root);
    const messages = join(root, "messages.db"), runtime = join(root, "runtime.db");
    stripTeamPrivate({ messages, runtime }, { threads: new Set(["bob-chat", "bobs-inbox"]), bots: new Set(["bobs-own"]), attachments: new Set() });
    for (const sql of ["SELECT thread_id AS id FROM messages", "SELECT thread_id AS id FROM thread_state", "SELECT thread_id AS id FROM chat_followups", "SELECT thread_id AS id FROM notification_log"]) {
      expect(table(messages, sql).map((row) => row.id).sort()).toEqual(["main", "outside-thread", "room-thread"]);
    }
    expect(table(messages, "SELECT source_message_id AS id FROM work_bot_links").map(row => row.id)).toEqual(["shared"]);
    expect(JSON.stringify(table(messages, "SELECT json FROM messages WHERE thread_id = 'main'"))).not.toContain("bobs-inbox");
    expect(table(runtime, "SELECT id FROM assignments").map((row) => row.id)).toEqual(["as-team"]);
    expect(table(runtime, "SELECT assignment_id AS id FROM assignment_events").map((row) => row.id)).toEqual(["as-team"]);
    expect(table(messages, "SELECT bot_id AS id FROM memory_files").map((row) => row.id)).toEqual(["bot"]);
    expect(textOf(messages).toLowerCase()).not.toContain("secret");
    expect(textOf(messages)).toContain("team question");
  });

  it("on a Team Cloud the export carries the team's things and nothing of Bob's alone; off a team everything stays", async () => {
    process.env.OMB_CLOUD_ROLE = "team";
    const root = directory();
    teamData(root);
    const team = await exported(root);
    expect(team.warnings).toContain(TEAM_PRIVATE_NOTE);
    expect(existsSync(join(team.data, "workspaces", "bot", "MEMORY.md"))).toBe(true);
    expect(existsSync(join(team.data, "workspaces", "bot--room-room", "MEMORY.md"))).toBe(true);
    expect(existsSync(join(team.data, "task-workspaces", "bot", "main", "plan.md"))).toBe(true);
    expect(existsSync(join(team.data, "workspaces", `bot--member-${BOB}`))).toBe(false);
    expect(existsSync(join(team.data, "task-workspaces", "bot", "bob-chat"))).toBe(false);
    expect(existsSync(join(team.data, "people"))).toBe(false);
    const bots = JSON.parse(textOf(join(team.data, "bots.json"))) as Array<{ tasks: Array<{ threadId: string }> }>;
    expect(bots).toHaveLength(1);
    expect(bots[0]!.tasks.map((task) => task.threadId)).toEqual(["main", "outside-thread"]);
    expect(existsSync(join(team.data, "person-inbox.json"))).toBe(false);
    expect(existsSync(join(team.data, "attachments", "bobs.png"))).toBe(false);
    expect(existsSync(join(team.data, "attachments", "unsent.png"))).toBe(false);
    expect(existsSync(join(team.data, "attachments", "12345678-1234-4234-8234-123456789abc.pdf"))).toBe(false);
    expect(existsSync(join(team.data, "attachments", ".openmaus-upload-12345678-1234-4234-8234-123456789abc-12345678-1234-4234-8234-123456789abc.partial"))).toBe(false);
    expect(existsSync(join(team.data, "attachments", ".openmaus-upload-22345678-1234-4234-8234-123456789abc-32345678-1234-4234-8234-123456789abc.partial"))).toBe(false);
    expect(existsSync(join(team.data, "attachments", "both.png"))).toBe(true);
    expect(existsSync(join(team.data, "attachments", "avatar.png"))).toBe(true);
    expect(existsSync(join(team.data, "workspaces", "bobs-own"))).toBe(false);
    expect(table(join(team.data, "messages.db"), "SELECT thread_id AS id FROM messages").map((row) => row.id).sort()).toEqual(["main", "outside-thread", "room-thread"]);
    for (const name of ["work_bot_upload_owners", "work_bot_upload_receipts", "work_bot_message_upload_sets"]) {
      expect(table(join(team.data, "messages.db"), `SELECT * FROM ${name}`)).toEqual([]);
      expect(table(join(root, "messages.db"), `SELECT * FROM ${name}`)).toHaveLength(1);
    }
    expect(table(join(team.data, "runtime.db"), "SELECT id FROM assignments").map((row) => row.id)).toEqual(["as-team"]);
    expect(table(join(team.data, "messages.db"), "SELECT source_thread AS id FROM report_sections").map(row => row.id)).toEqual(["room-thread"]);
    expect(textOf(join(team.data, "messages.db")).toLowerCase()).not.toContain("secret");

    process.env.OMB_CLOUD_ROLE = "home";
    const own = directory();
    teamData(own);
    const home = await exported(own);
    expect(home.warnings).not.toContain(TEAM_PRIVATE_NOTE);
    expect(existsSync(join(home.data, "attachments", "12345678-1234-4234-8234-123456789abc.pdf"))).toBe(true);
    expect(existsSync(join(home.data, "workspaces", `bot--member-${BOB}`, "MEMORY.md"))).toBe(true);
    expect(table(join(home.data, "messages.db"), "SELECT thread_id AS id FROM messages").map((row) => row.id).sort()).toEqual(["bob-chat", "bobs-inbox", "main", "outside-thread", "room-thread"]);
    expect(table(join(home.data, "messages.db"), "SELECT * FROM work_bot_upload_receipts")).toHaveLength(1);
  }, 60_000);
});
