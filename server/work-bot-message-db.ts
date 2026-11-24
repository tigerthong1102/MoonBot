import type { DatabaseSync } from "node:sqlite";
import type { Message } from "./store.ts";

export function createWorkBotMessageDb(deps: {
  db(): DatabaseSync;
  transaction<T>(fn: (database: DatabaseSync) => T): T;
  insertMessage(threadId: string, message: Message): void;
  setActiveLeaf(threadId: string, leafId: string | null): void;
}) {
  return {
    appendMessageBatch(threadId: string, messages: Message[]): void {
      if (!messages.length) return;
      deps.transaction(() => {
        for (const message of messages) deps.insertMessage(threadId, message);
        deps.setActiveLeaf(threadId, messages[messages.length - 1]!.id);
      });
    },
    pendingWorkBotRoutes(): Array<{ threadId: string; message: Message }> {
      const rows = deps.db().prepare(
        "SELECT thread_id, json FROM messages WHERE role = 'user' AND kind = 'text' AND " +
        "json_extract(json, '$.workBotRouting.state') IN ('classifying', 'waiting_choice', 'dispatching')",
      ).all() as Array<{ thread_id: string; json: string }>;
      return rows.map(row => ({ threadId: row.thread_id, message: JSON.parse(row.json) as Message }));
    },
  };
}
