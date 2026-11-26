import type { RoutineRequestStore } from "./routine-request-store.ts";
import type { Routine } from "./routines.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";

export type WorkBotLinkLookup = (threadId: string) => readonly WorkBotLink[];

export function isHeldHandoffSchedule(
  store: RoutineRequestStore,
  links: WorkBotLinkLookup | undefined,
  routine: Routine,
  threadId: string,
): boolean {
  const sourceThreadId = routine.sourceThreadId;
  if (!sourceThreadId || !links) return false;
  const incoming = links(threadId).filter(link => link.targetThreadId === threadId && link.targetBotId === routine.botId);
  if (sourceThreadId === threadId) return incoming.length > 0;
  const origins = incoming.filter(link => link.sourceThreadId === sourceThreadId);
  if (!origins.length) return false;
  if (routine.delegatedFromMessageId) return origins.some(link => link.sourceMessageId === routine.delegatedFromMessageId);
  return store.messagesFor(sourceThreadId).some(message => {
    const card = message.card;
    const receipt = card?.routineRequest;
    return card?.answered === "allow" && !card.undone && receipt?.operation?.action === "create"
      && receipt.threadId === sourceThreadId && receipt.operation.forBot?.botId === routine.botId && receipt.resultId === routine.id
      && origins.some(link => link.sourceMessageId === message.requestMessageId && link.sourceBotId === receipt.botId);
  });
}
