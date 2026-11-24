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
        "SELECT source.thread_id, source.json FROM messages source WHERE source.role = 'user' AND source.kind = 'text' AND (" +
        "json_extract(source.json, '$.workBotRouting.state') IN ('classifying', 'waiting_choice', 'dispatching') OR (" +
        "json_extract(source.json, '$.workBotRouting.state') IN ('dispatched', 'interrupted') AND EXISTS (" +
        "SELECT 1 FROM messages target WHERE target.thread_id = json_extract(source.json, '$.workBotRouting.targetThreadId') AND " +
        "(target.id = source.id OR json_extract(target.json, '$.sendId') = 'workbot-' || source.id) AND " +
        "(json_extract(target.json, '$.requestPending') = 1 OR json_extract(target.json, '$.workBotRecoveryPending') = 1))))",
      ).all() as Array<{ thread_id: string; json: string }>;
      return rows.map(row => ({ threadId: row.thread_id, message: JSON.parse(row.json) as Message }));
    },
    pendingWorkBotTargets(): Array<{ threadId: string; message: Message }> {
      const rows = deps.db().prepare("SELECT thread_id, json FROM messages WHERE role = 'user' AND kind = 'text' AND (json_extract(json, '$.requestPending') = 1 OR json_extract(json, '$.workBotRecoveryPending') = 1) AND json_extract(json, '$.workBotHandoffSource.messageId') IS NOT NULL").all() as Array<{ thread_id: string; json: string }>;
      return rows.map(row => ({ threadId: row.thread_id, message: JSON.parse(row.json) as Message }));
    },
  };
}
