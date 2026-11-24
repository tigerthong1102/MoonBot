import type { DatabaseSync } from "node:sqlite";
import type { Message } from "./store.ts";
import { newWorkBotReceipt } from "./work-bot-receipt.ts";

export function createWorkBotMessageDb(deps: {
  db(): DatabaseSync;
  transaction<T>(fn: (database: DatabaseSync) => T): T;
  durableTransaction(fn: (database: DatabaseSync) => void): void;
  insertMessage(threadId: string, message: Message): void;
  setActiveLeaf(threadId: string, leafId: string | null): void;
}) {
  return {
    verifiedWorkBotFollowup(queueId: string, sourceThreadId: string, sourceMessageId: string, targetThreadId: string, messageId: string): boolean {
      return Boolean(deps.db().prepare("SELECT 1 FROM chat_followups WHERE id = ? AND thread_id = ? AND kind = 'bot' AND status = 'transferred' AND json_extract(payload, '$.transfer.sourceMessageId') = ? AND json_extract(payload, '$.transfer.threadId') = ? AND json_extract(payload, '$.transfer.messageId') = ?").get(queueId, sourceThreadId, sourceMessageId, targetThreadId, messageId));
    },
    transferredChatFollowup(ownerId: string, threadId: string, sendId: string): { id: string; salt: string; fingerprint: string } | null {
      const row = deps.db().prepare("SELECT id, payload FROM chat_followups WHERE kind = 'bot' AND owner_id = ? AND thread_id = ? AND send_id = ? AND status = 'transferred'").get(ownerId, threadId, sendId) as { id: string; payload: string } | undefined;
      if (!row) return null;
      const transfer = (JSON.parse(row.payload) as { transfer?: { salt?: string; fingerprint?: string } }).transfer;
      return { id: row.id, salt: transfer?.salt ?? "", fingerprint: transfer?.fingerprint ?? "" };
    },
    appendMessageBatch(threadId: string, messages: Message[]): void {
      if (!messages.length) return;
      deps.transaction(() => {
        for (const message of messages) deps.insertMessage(threadId, message);
        deps.setActiveLeaf(threadId, messages[messages.length - 1]!.id);
      });
    },
    transferQueuedWorkBotMessages(threadId: string, messages: Message[], claim: { botId: string; sourceThreadId: string; sourceMessageId: string; queueIds: string[]; trigger?: unknown; offerOwner?: string }): void {
      if (!messages.length || !claim.queueIds.length || new Set(claim.queueIds).size !== claim.queueIds.length) throw new Error("Invalid work bot transfer");
      if (claim.queueIds.some(id => messages.filter(message => message.queueId === id && message.role === "user" && message.kind === "text").length !== 1) || messages.some(message => message.queueId && !claim.queueIds.includes(message.queueId))) throw new Error("Incomplete work bot transfer");
      if (messages.filter(message => !message.queueId && message.workBotHandoffSource?.threadId === claim.sourceThreadId && message.workBotHandoffSource.messageId === claim.sourceMessageId && message.workBotRecoveryPending === true).length !== 1 || claim.queueIds.some(id => !messages.some(message => message.queueId === id && message.workBotHandoffSource?.threadId === claim.sourceThreadId && message.workBotHandoffSource.messageId === claim.sourceMessageId && message.workBotRecoveryPending === true))) throw new Error("Work bot recovery receipt is missing");
      deps.durableTransaction(database => {
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
