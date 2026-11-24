import type { DatabaseSync } from "node:sqlite";
import type { Message } from "./store.ts";
import { newWorkBotReceipt } from "./work-bot-receipt.ts";

export const WORK_BOT_LINK_SCHEMA = `
    CREATE TABLE IF NOT EXISTS work_bot_links (
      source_bot_id TEXT NOT NULL, source_thread_id TEXT NOT NULL, source_message_id TEXT NOT NULL,
      target_bot_id TEXT NOT NULL, target_thread_id TEXT NOT NULL,
      PRIMARY KEY (source_thread_id, source_message_id), UNIQUE (target_thread_id, source_message_id)
    );
    CREATE INDEX IF NOT EXISTS work_bot_links_target ON work_bot_links(target_thread_id);
    CREATE INDEX IF NOT EXISTS work_bot_links_source_bot ON work_bot_links(source_bot_id);
    CREATE INDEX IF NOT EXISTS work_bot_links_target_bot ON work_bot_links(target_bot_id);
`;

export function migrateWorkBotLinks(db: DatabaseSync): void {
  if (!db.prepare("SELECT 1 FROM command_receipts WHERE kind = 'migration' AND key = 'work_bot_links_v1'").get()) {
    db.exec(`BEGIN IMMEDIATE;
      INSERT OR IGNORE INTO work_bot_links (source_bot_id, source_thread_id, source_message_id, target_bot_id, target_thread_id)
      SELECT json_extract(source.json, '$.workBotRouting.sourceBotId'), source.thread_id, source.id,
             json_extract(source.json, '$.workBotRouting.targetBotId'), json_extract(source.json, '$.workBotRouting.targetThreadId')
      FROM messages source
      WHERE source.role = 'user'
        AND (json_extract(source.json, '$.workBotRouting.state') = 'dispatched' OR
          (json_extract(source.json, '$.workBotRouting.state') IN ('dispatching', 'interrupted') AND EXISTS (
            SELECT 1 FROM messages target WHERE target.thread_id = json_extract(source.json, '$.workBotRouting.targetThreadId')
              AND target.role = 'user' AND json_extract(target.json, '$.workBotHandoffSource.threadId') = source.thread_id
              AND json_extract(target.json, '$.workBotHandoffSource.messageId') = source.id)))
        AND length(json_extract(source.json, '$.workBotRouting.sourceBotId')) > 0
        AND length(json_extract(source.json, '$.workBotRouting.targetBotId')) > 0
        AND length(json_extract(source.json, '$.workBotRouting.targetThreadId')) > 0
        AND source.thread_id <> json_extract(source.json, '$.workBotRouting.targetThreadId');
      INSERT INTO command_receipts (kind, key, at, result) VALUES ('migration', 'work_bot_links_v1', 0, '{}');
      COMMIT;`);
  }
}

export type WorkBotLink = { sourceBotId: string; sourceThreadId: string; sourceMessageId: string; targetBotId: string; targetThreadId: string };

export function createWorkBotMessageDb(deps: {
  db(): DatabaseSync;
  transaction<T>(fn: (database: DatabaseSync) => T): T;
  durableTransaction(fn: (database: DatabaseSync) => void): void;
  insertMessage(threadId: string, message: Message): void;
  setActiveLeaf(threadId: string, leafId: string | null): void;
}) {
  function saveLink(database: DatabaseSync, threadId: string, link?: WorkBotLink): void {
    if (!link) return;
    if (link.targetThreadId !== threadId || Object.values(link).some(value => !value) || link.sourceThreadId === link.targetThreadId) throw new Error("Invalid work bot link");
    database.prepare("INSERT INTO work_bot_links (source_bot_id, source_thread_id, source_message_id, target_bot_id, target_thread_id) VALUES (?, ?, ?, ?, ?)").run(link.sourceBotId, link.sourceThreadId, link.sourceMessageId, link.targetBotId, link.targetThreadId);
  }
  return {
    recoverLegacyWorkBotLinks(botForThread: (threadId: string) => string | undefined): void {
      deps.durableTransaction(database => {
        if (database.prepare("SELECT 1 FROM command_receipts WHERE kind = 'migration' AND key = 'work_bot_links_v2'").get()) return;
        const rows = database.prepare("SELECT thread_id, json FROM messages WHERE role = 'user' AND kind = 'text' AND json_extract(json, '$.workBotHandoffSource.messageId') IS NOT NULL").all() as Array<{ thread_id: string; json: string }>;
        const insert = database.prepare("INSERT OR IGNORE INTO work_bot_links (source_bot_id, source_thread_id, source_message_id, target_bot_id, target_thread_id) VALUES (?, ?, ?, ?, ?)");
        let unresolved = false;
        for (const row of rows) {
          const message = JSON.parse(row.json) as Message;
          const source = message.workBotHandoffSource;
          if (!source || !source.threadId || !source.messageId || message.sendId !== `workbot-${source.messageId}` || source.threadId === row.thread_id) continue;
          const sourceBot = botForThread(source.threadId), targetBot = botForThread(row.thread_id);
          if (!sourceBot || !targetBot) { unresolved = true; continue; }
          if (sourceBot === targetBot || (source.botId && source.botId !== sourceBot)) continue;
          insert.run(sourceBot, source.threadId, source.messageId, targetBot, row.thread_id);
        }
        if (!unresolved) database.prepare("INSERT INTO command_receipts (kind, key, at, result) VALUES ('migration', 'work_bot_links_v2', 0, '{}')").run();
      });
    },
    workBotLinksForThread(threadId: string, botId?: string): WorkBotLink[] {
      const rows = deps.db().prepare("SELECT source_bot_id, source_thread_id, source_message_id, target_bot_id, target_thread_id FROM work_bot_links WHERE source_thread_id = ? OR target_thread_id = ? OR source_bot_id = ? OR target_bot_id = ?").all(threadId, threadId, botId ?? "", botId ?? "") as Array<{ source_bot_id: string; source_thread_id: string; source_message_id: string; target_bot_id: string; target_thread_id: string }>;
      return rows.map(row => ({ sourceBotId: row.source_bot_id, sourceThreadId: row.source_thread_id, sourceMessageId: row.source_message_id, targetBotId: row.target_bot_id, targetThreadId: row.target_thread_id }));
    },
    verifiedWorkBotFollowup(queueId: string, sourceThreadId: string, sourceMessageId: string, targetThreadId: string, messageId: string): boolean {
      return Boolean(deps.db().prepare("SELECT 1 FROM chat_followups WHERE id = ? AND thread_id = ? AND kind = 'bot' AND status = 'transferred' AND json_extract(payload, '$.transfer.sourceMessageId') = ? AND json_extract(payload, '$.transfer.threadId') = ? AND json_extract(payload, '$.transfer.messageId') = ?").get(queueId, sourceThreadId, sourceMessageId, targetThreadId, messageId));
    },
    transferredChatFollowup(ownerId: string, threadId: string, sendId: string): { id: string; salt: string; fingerprint: string } | null {
      const row = deps.db().prepare("SELECT id, payload FROM chat_followups WHERE kind = 'bot' AND owner_id = ? AND thread_id = ? AND send_id = ? AND status = 'transferred'").get(ownerId, threadId, sendId) as { id: string; payload: string } | undefined;
      if (!row) return null;
      const transfer = (JSON.parse(row.payload) as { transfer?: { salt?: string; fingerprint?: string } }).transfer;
      return { id: row.id, salt: transfer?.salt ?? "", fingerprint: transfer?.fingerprint ?? "" };
    },
    appendMessageBatch(threadId: string, messages: Message[], link?: WorkBotLink): void {
      if (!messages.length) return;
      deps.transaction(database => {
        saveLink(database, threadId, link);
        for (const message of messages) deps.insertMessage(threadId, message);
        deps.setActiveLeaf(threadId, messages[messages.length - 1]!.id);
      });
    },
    transferQueuedWorkBotMessages(threadId: string, messages: Message[], claim: { botId: string; sourceThreadId: string; sourceMessageId: string; queueIds: string[]; trigger?: unknown; offerOwner?: string }, link?: WorkBotLink): void {
      if (!messages.length || !claim.queueIds.length || new Set(claim.queueIds).size !== claim.queueIds.length) throw new Error("Invalid work bot transfer");
      if (claim.queueIds.some(id => messages.filter(message => message.queueId === id && message.role === "user" && message.kind === "text").length !== 1) || messages.some(message => message.queueId && !claim.queueIds.includes(message.queueId))) throw new Error("Incomplete work bot transfer");
      if (messages.filter(message => !message.queueId && message.workBotHandoffSource?.threadId === claim.sourceThreadId && message.workBotHandoffSource.messageId === claim.sourceMessageId && message.workBotRecoveryPending === true).length !== 1 || claim.queueIds.some(id => !messages.some(message => message.queueId === id && message.workBotHandoffSource?.threadId === claim.sourceThreadId && message.workBotHandoffSource.messageId === claim.sourceMessageId && message.workBotRecoveryPending === true))) throw new Error("Work bot recovery receipt is missing");
      deps.durableTransaction(database => {
        if (link && (link.sourceBotId !== claim.botId || link.sourceThreadId !== claim.sourceThreadId || link.sourceMessageId !== claim.sourceMessageId)) throw new Error("Invalid work bot link");
        saveLink(database, threadId, link);
        const leaf = database.prepare("SELECT active_leaf_id FROM thread_state WHERE thread_id = ?").get(threadId) as { active_leaf_id: string | null } | undefined;
        if ((messages[0]!.parentId ?? null) !== (leaf?.active_leaf_id ?? null) || messages.slice(1).some((message, index) => message.parentId !== messages[index]!.id)) throw new Error("Work bot destination changed during handoff");
        const existing = database.prepare("SELECT 1 FROM messages WHERE thread_id = ? AND id = ?");
        if (new Set(messages.map(message => message.id)).size !== messages.length || messages.some(message => existing.get(threadId, message.id))) throw new Error("Work bot destination message already exists");
        const pending = database.prepare("SELECT payload FROM chat_followups WHERE id = ? AND kind = 'bot' AND owner_id = ? AND thread_id = ? AND status = 'pending' AND json_extract(payload, '$.workBotOfferSource') = ?");
        const update = database.prepare("UPDATE chat_followups SET status = 'transferred', payload = ? WHERE id = ? AND kind = 'bot' AND owner_id = ? AND thread_id = ? AND status = 'pending' AND json_extract(payload, '$.workBotOfferSource') = ?");
        for (const id of claim.queueIds) {
          const row = pending.get(id, claim.botId, claim.sourceThreadId, claim.sourceMessageId) as { payload: string } | undefined;
          if (!row) throw new Error("Queued work changed during handoff");
          const payload = JSON.parse(row.payload) as { text: string; prompt?: string; sendId?: string; sender?: Message["sender"]; [key: string]: unknown };
          const destination = messages.find(message => message.queueId === id && message.role === "user")!;
          const allowed = new Set(["messageId", "text", "prompt", "sendId", "sender", "queuedAt", "trigger", "workBotOfferOwner", "workBotOfferSource", "workBotFollowUp"]);
          if (Object.entries(payload).some(([key, value]) => value !== undefined && !allowed.has(key)) || (payload.prompt !== undefined && payload.prompt !== payload.text)) throw new Error("Queued work cannot be transferred safely");
          if (JSON.stringify(payload.trigger ?? null) !== JSON.stringify(claim.trigger ?? null) || payload.workBotOfferOwner !== claim.offerOwner || (payload.queuedAt !== undefined && payload.queuedAt !== destination.at)) throw new Error("Queued work ownership changed during handoff");
          if (destination.text !== payload.text || destination.sendId !== payload.sendId || JSON.stringify(destination.sender ?? null) !== JSON.stringify(payload.sender ?? null)) throw new Error("Queued work does not match its destination");
          const receipt = JSON.stringify(newWorkBotReceipt(payload.text, payload.sender, (payload.trigger as { kind?: string } | undefined)?.kind, threadId, destination.id, claim.sourceMessageId, payload.workBotFollowUp as import("../shared/follow-up.ts").FollowUp | undefined));
          if (update.run(receipt, id, claim.botId, claim.sourceThreadId, claim.sourceMessageId).changes !== 1) throw new Error("Queued work changed during handoff");
        }
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
