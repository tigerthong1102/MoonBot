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
    CREATE TABLE chat_followups (id TEXT, kind TEXT, owner_id TEXT, thread_id TEXT, status TEXT, payload TEXT);`);
  const link = { sourceBotId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", targetBotId: "worker", targetThreadId: "target" };
  const source = { id: "request", at: 1, role: "user", kind: "text", text: "FIXTURE_WORK", workBotRouting: { state: "dispatching", sourceBotId: "main-bot", targetBotId: "worker", targetThreadId: "target" } } as Message;
  const held = { id: "copy", at: 2, role: "user", kind: "text", text: source.text, sendId: "workbot-request", requestPending: false, workBotReviewHold: true, workBotHandoffSource: { threadId: "source", messageId: "request", botId: "main-bot" } } as Message;
  const insert = (threadId: string, message: Message) => { db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?) ON CONFLICT(thread_id,id) DO UPDATE SET role=excluded.role,kind=excluded.kind,json=excluded.json").run(threadId, message.id, message.role, message.kind, JSON.stringify(message)); };
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
      f.db.prepare("INSERT INTO chat_followups VALUES ('queue-1', 'bot', 'main-bot', 'source', 'pending', ?)").run(JSON.stringify({ workBotOfferSource: "request" }));
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held], null)).toThrow("Queued followups");
      expect(f.current().workBotRouting?.state).toBe("dispatching");
      expect(f.db.prepare("SELECT count(*) AS n FROM work_bot_links").get()).toEqual({ n: 0 });
    } finally { f.db.close(); }
  });

  it("moves queued followups with the held request and does not leave them pending", () => {
    const f = fixture();
    try {
      const payload = { text: "FOLLOWUP_FIXTURE", sendId: "send-1", queuedAt: 3, workBotOfferSource: "request" };
      f.db.prepare("INSERT INTO chat_followups VALUES ('queue-1', 'bot', 'main-bot', 'source', 'pending', ?)").run(JSON.stringify(payload));
      const followup = { ...f.held, id: "followup", parentId: "copy", at: 3, text: payload.text, sendId: payload.sendId, queueId: "queue-1" };
      const claim = { botId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", queueIds: ["queue-1"] };
      commitHeldWorkBotContext(f.deps, f.link, [f.held, followup], null, claim);
      const row = f.db.prepare("SELECT status, payload FROM chat_followups WHERE id='queue-1'").get() as { status: string; payload: string };
      expect(row.status).toBe("transferred");
      expect(row.payload).not.toContain("FOLLOWUP_FIXTURE");
      expect(f.db.prepare("SELECT count(*) AS n FROM messages WHERE thread_id='target'").get()).toEqual({ n: 2 });
      expect(f.current().workBotRouting?.state).toBe("held_for_review");
    } finally { f.db.close(); }
  });

  it("rolls back followup receipts if a held message write fails", () => {
    const f = fixture();
    try {
      const payload = { text: "FOLLOWUP_FIXTURE", sendId: "send-1", queuedAt: 3, workBotOfferSource: "request" };
      f.db.prepare("INSERT INTO chat_followups VALUES ('queue-1', 'bot', 'main-bot', 'source', 'pending', ?)").run(JSON.stringify(payload));
      const followup = { ...f.held, id: "followup", parentId: "copy", at: 3, text: payload.text, sendId: payload.sendId, queueId: "queue-1" };
      const claim = { botId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", queueIds: ["queue-1"] };
      expect(() => commitHeldWorkBotContext({ ...f.deps, insert: () => { throw new Error("fixture failure"); } }, f.link, [f.held, followup], null, claim)).toThrow("fixture failure");
      expect(f.db.prepare("SELECT status FROM chat_followups WHERE id='queue-1'").get()).toEqual({ status: "pending" });
      expect(f.current().workBotRouting?.state).toBe("dispatching");
      expect(f.db.prepare("SELECT count(*) AS n FROM work_bot_links").get()).toEqual({ n: 0 });
    } finally { f.db.close(); }
  });

  it("rolls back if a followup arrives after the claimed snapshot", () => {
    const f = fixture();
    try {
      const payload = { text: "FIRST_FIXTURE", sendId: "send-1", queuedAt: 3, workBotOfferSource: "request" };
      const insertQueue = f.db.prepare("INSERT INTO chat_followups VALUES (?, 'bot', 'main-bot', 'source', 'pending', ?)");
      insertQueue.run("queue-1", JSON.stringify(payload));
      insertQueue.run("queue-2", JSON.stringify({ ...payload, text: "LATE_FIXTURE", sendId: "send-2" }));
      const first = { ...f.held, id: "followup", parentId: "copy", at: 3, text: payload.text, sendId: payload.sendId, queueId: "queue-1" };
      const claim = { botId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", queueIds: ["queue-1"] };
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held, first], null, claim)).toThrow("Queued followups");
      expect(f.db.prepare("SELECT count(*) AS n FROM chat_followups WHERE status='pending'").get()).toEqual({ n: 2 });
      expect(f.current().workBotRouting?.state).toBe("dispatching");
      expect(f.db.prepare("SELECT count(*) AS n FROM work_bot_links").get()).toEqual({ n: 0 });
    } finally { f.db.close(); }
  });

  it("keeps two followups in order with durable receipts", () => {
    const f = fixture();
    try {
      const insertQueue = f.db.prepare("INSERT INTO chat_followups VALUES (?, 'bot', 'main-bot', 'source', 'pending', ?)");
      insertQueue.run("queue-1", JSON.stringify({ text: "FIRST_FIXTURE", sendId: "send-1", queuedAt: 3, workBotOfferSource: "request" }));
      insertQueue.run("queue-2", JSON.stringify({ text: "SECOND_FIXTURE", sendId: "send-2", queuedAt: 4, workBotOfferSource: "request" }));
      const first = { ...f.held, id: "first", parentId: "copy", at: 3, text: "FIRST_FIXTURE", sendId: "send-1", queueId: "queue-1" };
      const second = { ...f.held, id: "second", parentId: "first", at: 4, text: "SECOND_FIXTURE", sendId: "send-2", queueId: "queue-2" };
      const claim = { botId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", queueIds: ["queue-1", "queue-2"] };
      commitHeldWorkBotContext(f.deps, f.link, [f.held, first, second], null, claim);
      const api = createWorkBotMessageDb({ db: () => f.db, transaction: fn => fn(f.db), durableTransaction: fn => fn(f.db), insertMessage: () => {}, setActiveLeaf: () => {} });
      expect(api.verifiedWorkBotFollowup("queue-1", "source", "request", "target", "first")).toBe(true);
      expect(api.verifiedWorkBotFollowup("queue-2", "source", "request", "target", "second")).toBe(true);
      expect(f.db.prepare("SELECT active_leaf_id FROM thread_state WHERE thread_id='target'").get()).toEqual({ active_leaf_id: "second" });
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

  it("rejects a duplicate queued send ID without changing source or receipts", () => {
    const f = fixture();
    try {
      const payload = { text: "FOLLOWUP_FIXTURE", sendId: "workbot-request", queuedAt: 3, workBotOfferSource: "request" };
      f.db.prepare("INSERT INTO chat_followups VALUES ('queue-1', 'bot', 'main-bot', 'source', 'pending', ?)").run(JSON.stringify(payload));
      const followup = { ...f.held, id: "followup", parentId: "copy", at: 3, text: payload.text, sendId: payload.sendId, queueId: "queue-1" };
      const claim = { botId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", queueIds: ["queue-1"] };
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held, followup], null, claim)).toThrow("already exists");
      expect(f.db.prepare("SELECT status FROM chat_followups WHERE id='queue-1'").get()).toEqual({ status: "pending" });
      expect(f.current().workBotRouting?.state).toBe("dispatching");
    } finally { f.db.close(); }
  });

  it("never overwrites an existing destination message even with an upsert writer", () => {
    const f = fixture();
    try {
      f.deps.insert("target", { ...f.held, text: "ORIGINAL_FIXTURE", sendId: "different-send" });
      const payload = { text: "FOLLOWUP_FIXTURE", sendId: "send-1", queuedAt: 3, workBotOfferSource: "request" };
      f.db.prepare("INSERT INTO chat_followups VALUES ('queue-1', 'bot', 'main-bot', 'source', 'pending', ?)").run(JSON.stringify(payload));
      const followup = { ...f.held, id: "followup", parentId: "copy", at: 3, text: payload.text, sendId: payload.sendId, queueId: "queue-1" };
      const claim = { botId: "main-bot", sourceThreadId: "source", sourceMessageId: "request", queueIds: ["queue-1"] };
      expect(() => commitHeldWorkBotContext(f.deps, f.link, [f.held, followup], null, claim)).toThrow("destination message already exists");
      const row = f.db.prepare("SELECT json FROM messages WHERE thread_id='target' AND id='copy'").get() as { json: string };
      expect(JSON.parse(row.json).text).toBe("ORIGINAL_FIXTURE");
      expect(f.db.prepare("SELECT status FROM chat_followups WHERE id='queue-1'").get()).toEqual({ status: "pending" });
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
