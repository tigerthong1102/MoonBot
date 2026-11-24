import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createWorkBotMessageDb } from "./work-bot-message-db.ts";

it("finds unresolved dispatches without treating completed requests as interrupted", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE messages (thread_id TEXT, id TEXT, role TEXT, kind TEXT, json TEXT)");
    const insert = db.prepare("INSERT INTO messages VALUES (?, ?, 'user', 'text', ?)");
    const source = (id: string, state: string, targetThreadId: string, requestPending?: boolean) => insert.run("main", id, JSON.stringify({ id, role: "user", kind: "text", requestPending, workBotRouting: { state, targetThreadId } }));
    const target = (id: string, requestPending: boolean) => insert.run(`target-${id}`, `copy-${id}`, JSON.stringify({ id: `copy-${id}`, sendId: `workbot-${id}`, requestPending }));
    source("pending", "dispatched", "target-pending"); target("pending", true);
    source("finished", "dispatched", "target-finished"); target("finished", false);
    source("partial", "dispatching", "target-partial");
    source("self", "dispatched", "main", true);
    source("settled-self", "dispatched", "main", false);
    source("already-interrupted", "interrupted", "target-already-interrupted"); target("already-interrupted", true);
    const api = createWorkBotMessageDb({ db: () => db, transaction: fn => fn(db), insertMessage: () => {}, setActiveLeaf: () => {} });
    expect(api.pendingWorkBotRoutes().map(row => row.message.id).sort()).toEqual(["already-interrupted", "partial", "pending", "self"]);
  } finally {
    db.close();
  }
});
