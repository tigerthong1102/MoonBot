import type { DatabaseSync } from "node:sqlite";
import type { Message } from "./store.ts";
import { promptWithDataContext } from "../shared/data-context.ts";
import { unsupportedWorkBotContext } from "./work-bot-context.ts";
import { moveQueuedUploads, portableUpload, queuedUploadMessage } from "./work-bot-upload-context.ts";
import { newWorkBotReceipt } from "./work-bot-receipt.ts";

export type WorkBotFollowupClaim = { botId: string; sourceThreadId: string; sourceMessageId: string; queueIds: string[]; trigger?: unknown; offerOwner?: string; dataCardIds?: Readonly<Record<string, string>> };

export function transferWorkBotFollowups(database: DatabaseSync, threadId: string, messages: readonly Message[], claim: WorkBotFollowupClaim): void {
  const pending = database.prepare("SELECT payload FROM chat_followups WHERE id = ? AND kind = 'bot' AND owner_id = ? AND thread_id = ? AND status = 'pending' AND json_extract(payload, '$.workBotOfferSource') = ?");
  const update = database.prepare("UPDATE chat_followups SET status = 'transferred', payload = ? WHERE id = ? AND kind = 'bot' AND owner_id = ? AND thread_id = ? AND status = 'pending' AND json_extract(payload, '$.workBotOfferSource') = ?");
  for (const id of claim.queueIds) {
    const row = pending.get(id, claim.botId, claim.sourceThreadId, claim.sourceMessageId) as { payload: string } | undefined;
    if (!row) throw new Error("Queued work changed during handoff");
    const payload = JSON.parse(row.payload) as import("./message-db.ts").FollowupPayload;
    const destination = messages.find(message => message.queueId === id && message.role === "user");
    if (!destination) throw new Error("Incomplete work bot transfer");
    const allowed = new Set(["messageId", "text", "prompt", "sendId", "sender", "queuedAt", "trigger", "workBotOfferOwner", "workBotOfferSource", "workBotFollowUp", "workBotUploadNonce", "dataContext"]);
    if (Object.entries(payload).some(([key, value]) => value !== undefined && !allowed.has(key)) || (payload.prompt !== undefined && payload.prompt !== promptWithDataContext(payload.text, payload.dataContext))) throw new Error("Queued work cannot be transferred safely");
    if (JSON.stringify(payload.trigger ?? null) !== JSON.stringify(claim.trigger ?? null) || payload.workBotOfferOwner !== claim.offerOwner || (payload.queuedAt !== undefined && payload.queuedAt !== destination.at)) throw new Error("Queued work ownership changed during handoff");
    if (destination.text !== payload.text || destination.sendId !== payload.sendId || JSON.stringify(destination.sender ?? null) !== JSON.stringify(payload.sender ?? null)) throw new Error("Queued work does not match its destination");
    if (payload.dataContext) {
      const mapped = Object.hasOwn(claim.dataCardIds ?? {}, payload.dataContext.cardId) ? claim.dataCardIds![payload.dataContext.cardId] : undefined;
      if (!mapped || destination.dataContext?.cardId !== mapped || destination.dataContext.draftSql !== payload.dataContext.draftSql) throw new Error("Queued Data context differs from its destination");
    } else if (destination.dataContext) throw new Error("Unexpected queued Data context");
    const queued = queuedUploadMessage(id, payload);
    if (unsupportedWorkBotContext([queued], row => portableUpload(database, claim.sourceThreadId, row)?.prose, () => Boolean(destination.dataContext))) throw new Error("Queued work cannot be transferred safely");
    moveQueuedUploads(database, claim.sourceThreadId, queued, threadId, destination);
    const receipt = JSON.stringify(newWorkBotReceipt(payload.text, payload.sender, (payload.trigger as { kind?: string } | undefined)?.kind, threadId, destination.id, claim.sourceMessageId, payload.workBotFollowUp, payload.dataContext));
    if (update.run(receipt, id, claim.botId, claim.sourceThreadId, claim.sourceMessageId).changes !== 1) throw new Error("Queued work changed during handoff");
  }
}
