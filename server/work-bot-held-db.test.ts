import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Message } from "./store.ts";
import { commitHeldWorkBotContext } from "./work-bot-held-db.ts";
import { createWorkBotMessageDb } from "./work-bot-message-db.ts";

function fixture(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE messages (thread_id TEXT, id TEXT, role TEXT, kind TEXT, json TEXT, PRIMARY KEY(thread_id,id));
    CREATE TABLE thread_state (thread_id TEXT PRIMARY KEY, active_leaf_id TEXT);
    CREATE TABLE work_bot_links (source_bot_id TEXT, source_thread_id TEXT, source_message_id TEXT, target_bot_id TEXT, target_thread_id TEXT, PRIMARY KEY(source_thread_id,source_message_id));
    CREATE TABLE chat_followups (kind TEXT, owner_id TEXT, thread_id TEXT, status TEXT, payload TEXT);`);
  const link = { sourceBotId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", targetBotId: "worker", targetThreadId: "target" };
  const source = { id: "request", at: 1, role: "user", kind: "text", text: "FIXTURE_WORK", workBotRouting: { state: "dispatching", sourceBotId: "main-bot", targetBotId: "worker", targetThreadId: "target" } } as Message;
  const held = { id: "copy", at: 2, role: "user", kind: "text", text: source.text, sendId: "workbot-request", requestPending: false, workBotReviewHold: true, workBotHandoffSource: { threadId: "source", messageId: "request", botId: "main-bot" } } as Message;
  const insert = (threadId: string, message: Message) => { db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)").run(threadId, message.id, message.role, message.kind, JSON.stringify(message)); };
  insert("source", source);
  const deps = {
    durableTransaction: (write: (database: DatabaseSync) => void) => { db.exec("BEGIN IMMEDIATE"); try { write(db); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } },
    insert,
    setLeaf: (threadId: string, id: string) => { db.prepare("INSERT OR REPLACE INTO thread_state VALUES (?, ?)").run(threadId, id); },
  };
  const current = () => JSON.parse((db.prepare("SELECT json FROM messages WHERE thread_id = 'source'").get() as { json: string }).json) as Message;
  return { db, link, source, held, deps, current };
}

describe("durable held handoff", () => {
  it("commits the held source, destination and link together and rejects a duplicate", () => {
    const f = fixture();
    try {
      expect(commitHeldWorkBotContext(f.deps, f.link, [f.held], null).workBotRouting?.state).toBe("held_for_review");
      expect(f.current().workBotRouting?.state).toBe("held_for_review");
      expect(f.db.prepare("SELECT count(*) AS n FROM work_bot_links").get()).toEqual({ n: 1 });
      expect(f.db.prepare("SELECT count(*) AS n FROM messages WHERE thread_id='target'").get()).toEqual({ n: 1 });
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held], null)).toThrow();
      expect(f.db.prepare("SELECT count(*) AS n FROM messages WHERE thread_id='target'").get()).toEqual({ n: 1 });
    } finally { f.db.close(); }
  });

  it("rolls back the source, link and destination if a write fails", () => {
    const f = fixture();
    try {
      expect(() => commitHeldWorkBotContext({ ...f.deps, insert: () => { throw new Error("fixture write failure"); } }, f.link, [f.held], null)).toThrow("fixture write failure");
      expect(f.current().workBotRouting?.state).toBe("dispatching");
      expect(f.db.prepare("SELECT count(*) AS n FROM work_bot_links").get()).toEqual({ n: 0 });
      expect(f.db.prepare("SELECT count(*) AS n FROM messages WHERE thread_id='target'").get()).toEqual({ n: 0 });
    } finally { f.db.close(); }
  });

  it("leaves queued followups untouched until their atomic transfer is supported", () => {
    const f = fixture();
    try {
      f.db.prepare("INSERT INTO chat_followups VALUES ('bot', 'main-bot', 'source', 'pending', ?)").run(JSON.stringify({ workBotOfferSource: "request" }));
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held], null)).toThrow("Queued followups");
      expect(f.current().workBotRouting?.state).toBe("dispatching");
      expect(f.db.prepare("SELECT count(*) AS n FROM work_bot_links").get()).toEqual({ n: 0 });
    } finally { f.db.close(); }
  });

  it("refuses a held request that looks like a running request or names another source bot", () => {
    const f = fixture();
    try {
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [{ ...f.held, requestPending: true }], null)).toThrow();
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [{ ...f.held, workBotHandoffSource: { threadId: "source", messageId: "request", botId: "other" } }], null)).toThrow();
      expect(f.current().workBotRouting?.state).toBe("dispatching");
    } finally { f.db.close(); }
  });

  it("does not stage after the source branch changes or the destination already contains the request", () => {
    const f = fixture();
    try {
      f.deps.setLeaf("source", "new-leaf");
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held], "old-leaf")).toThrow("source changed");
      f.deps.insert("target", { ...f.held, id: "already-there" });
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held], "new-leaf")).toThrow("already exists");
      expect(f.current().workBotRouting?.state).toBe("dispatching");
      expect(f.db.prepare("SELECT count(*) AS n FROM work_bot_links").get()).toEqual({ n: 0 });
    } finally { f.db.close(); }
  });

  it("keeps staged work held after reopening the database without scheduling recovery", () => {
    const directory = mkdtempSync(join(tmpdir(), "workbot-held-fixture-"));
    const file = join(directory, "messages.sqlite");
    const f = fixture(file);
    try {
      commitHeldWorkBotContext(f.deps, f.link, [f.held], null);
      f.db.close();
      const reopened = new DatabaseSync(file);
      try {
        const api = createWorkBotMessageDb({ db: () => reopened, transaction: fn => fn(reopened), durableTransaction: fn => fn(reopened), insertMessage: () => {}, setActiveLeaf: () => {} });
        expect(api.pendingWorkBotRoutes()).toEqual([]);
        expect(api.pendingWorkBotTargets()).toEqual([]);
        const saved = reopened.prepare("SELECT json FROM messages WHERE thread_id='target'").get() as { json: string };
        expect(JSON.parse(saved.json)).toMatchObject({ id: "copy", workBotReviewHold: true, requestPending: false });
      } finally { reopened.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
