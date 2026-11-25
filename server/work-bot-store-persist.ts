import * as mdb from "./message-db.ts";
import type { Message } from "./store.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";

type Transfer = { claim: Parameters<typeof mdb.transferQueuedWorkBotMessages>[2]; afterCommit(): void };

export function persistWorkBotContext(threadId: string, messages: Message[], transfer: Transfer | undefined, link: WorkBotLink | undefined, hold: { expectedSourceLeaf: string | null } | undefined, patch: (threadId: string, messageId: string, patch: Partial<Message>) => Message | null): void {
  if (hold) {
    if (!link || link.targetThreadId !== threadId) throw new Error("Invalid held work link");
    const source = mdb.appendHeldWorkBotContext(link, messages, hold.expectedSourceLeaf, transfer?.claim);
    try {
      if (!patch(link.sourceThreadId, link.sourceMessageId, { workBotRouting: source.workBotRouting, requestPending: false })) throw new Error("Held work source is unavailable");
      transfer?.afterCommit();
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Could not reconcile held work"), { workBotCleanupFailed: true, workBotHeldCommitted: true }); }
  } else if (transfer) {
    mdb.transferQueuedWorkBotMessages(threadId, messages, transfer.claim, link);
    try { transfer.afterCommit(); }
    catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Could not reconcile transferred work"), { workBotCleanupFailed: true }); }
  } else mdb.appendMessageBatch(threadId, messages, link);
}
