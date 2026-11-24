import { defaultBotPerson } from "../../shared/default-bot.ts";
import { sameModelSelection } from "../../shared/thread-model.ts";
import { sameAccess } from "../../shared/bot-access.ts";
import { audienceMember, mayRead, type Audience } from "../audience.ts";
import { sameAudience } from "../bot-visibility.ts";
import { sinceFreshStart } from "../fresh-start.ts";
import { personKey } from "../person-key.ts";
import type { Message, Store } from "../store.ts";
import type { ReplyTarget } from "../replies.ts";
import type { UsageTrigger } from "../usage-ledger.ts";
import type { TeamSetupRequestService } from "../team-setup-requests.ts";
import { WorkBotRouter } from "../work-bot-routing.ts";
import { captureWorkBotContext, scanWorkBotContext, unsupportedWorkBotContext } from "../work-bot-context.ts";
import { mayDispatchWorkBot, type WorkBotMember } from "../work-bot-access.ts";

export function createWorkBotHost(deps: {
  store: Store;
  pendingWorkBotIds: Map<string, Set<string>>;
  workBotTargetLocks: Map<string, { sourceThreadId: string; messageId: string }>;
  indexWorkBotRouting(threadId: string, messageId: string, state: NonNullable<Message["workBotRouting"]>["state"]): void;
  drainQueuedSends(): void;
  assertAvailable(): void;
  offerWorkBot(botId: string, threadId: string, text: string, owner: string, messageId: string, signal?: AbortSignal, mayContinue?: () => boolean): ReturnType<TeamSetupRequestService["offerFromChat"]> | undefined;
  teamPersonFor(person: string): WorkBotMember | undefined;
  sessionFor(person: string): { email?: string } | undefined;
  cloudTeam: boolean;
  sharedNonTeam(): boolean;
  teamHost: { audienceOf(threadId: string): Audience };
  conversationShares: { isShareKey(person: string): boolean };
  threadStarters: { get(threadId: string): string | undefined; setRequired(threadId: string, person: string): void };
  threadBusy(botId: string, threadId: string): boolean;
  startTurn(botId: string, text: string, opts: { threadId: string; userMessage?: Message; sender?: Message["sender"]; trigger: UsageTrigger; replyTo?: ReplyTarget; dataContext?: Message["dataContext"]; sendId?: string; allowRoomTurnElsewhere: true; workBotRoutingMessageId: string; prepareWorkBotContext?: () => { userMessage: Message; replyTo?: ReplyTarget } }): Promise<unknown>;
}) {
  const { store, pendingWorkBotIds, workBotTargetLocks, indexWorkBotRouting, drainQueuedSends, assertAvailable, offerWorkBot, teamPersonFor, sessionFor, cloudTeam, sharedNonTeam, teamHost, conversationShares, threadStarters, threadBusy, startTurn } = deps;
function reconcileWorkBotBranch(threadId: string): void {
  const ids = pendingWorkBotIds.get(threadId);
  if (!ids?.size) return;
  const path = store.activePath(threadId);
  for (const id of ids) {
    const source = store.messagesFor(threadId).find(row => row.id === id);
    const route = source?.workBotRouting;
    if (!route || route.state === "dispatching") continue;
    const sourceVisible = path.some(row => row.id === id);
    const cardVisible = route.state !== "waiting_choice" || path.some(row => row.card?.requestId === route.requestId);
    if (!sourceVisible || !cardVisible) {
      if (source) store.patchMessage(threadId, id, { workBotRouting: { ...route, state: "interrupted" } });
      indexWorkBotRouting(threadId, id, "interrupted");
      queueMicrotask(drainQueuedSends);
    }
  }
}

function workBotRoutingBlocks(threadId: string, exceptMessageId?: string): boolean {
  const ids = pendingWorkBotIds.get(threadId);
  if (!ids?.size || (ids.size === 1 && exceptMessageId && ids.has(exceptMessageId))) return false;
  return store.activePath(threadId).some(message => message.id !== exceptMessageId && ids.has(message.id));
}

const workBotRouter = new WorkBotRouter({
  message: (threadId, messageId) => store.messagesFor(threadId).find(message => message.id === messageId),
  patch: (threadId, messageId, expected, routing) => {
    const message = store.messagesFor(threadId).find(row => row.id === messageId);
    if (!message || message.workBotRouting?.state !== expected) return false;
    if (!store.activePath(threadId).some(row => row.id === messageId)) {
      store.patchMessage(threadId, messageId, { workBotRouting: { ...message.workBotRouting, state: "interrupted" } });
      indexWorkBotRouting(threadId, messageId, "interrupted");
      queueMicrotask(drainQueuedSends);
      return false;
    }
    const updated = store.patchMessage(threadId, messageId, { workBotRouting: routing });
    if (updated) indexWorkBotRouting(threadId, messageId, routing.state);
    if (updated && (routing.state === "dispatched" || routing.state === "cancelled" || routing.state === "interrupted")) queueMicrotask(drainQueuedSends);
    return Boolean(updated);
  },
  offer: async (threadId, messageId, signal) => {
    assertAvailable();
    const source = store.messagesFor(threadId).find(row => row.id === messageId);
    const route = source?.workBotRouting;
    const bot = route?.sourceBotId ? store.bot(route.sourceBotId) : null;
    const owner = bot?.defaultBot ? defaultBotPerson(bot) : undefined;
    if (!source?.text || !route?.sourceBotId || !route.modelSelection || owner === undefined || route.ownerKey !== (owner ? personKey({ id: "", email: owner }) : "") || !sameModelSelection(store.projectBotForTask(route.sourceBotId, threadId)?.modelSelection, route.modelSelection)) return { interrupted: true };
    if (sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) return null;
    const path = sinceFreshStart(store.activePath(threadId));
    const sourceIndex = path.findIndex(row => row.id === messageId);
    if (sourceIndex < 0) return { interrupted: true };
    if (await scanWorkBotContext(path.slice(0, sourceIndex + 1), signal)) return null;
    if (signal.aborted || sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) return { interrupted: true };
    const previous = store.messagesFor(threadId).find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === messageId && row.card.requestId);
    if (previous?.card?.requestId) {
      if (!store.activePath(threadId).some(row => row.id === previous.id)) return { interrupted: true };
      return { requestId: previous.card.requestId };
    }
    const mayContinue = () => {
      if (signal.aborted || sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) return false;
      const current = sinceFreshStart(store.activePath(threadId));
      const index = current.findIndex(row => row.id === messageId);
      const person = source.sender?.id, member = person ? teamPersonFor(person) : undefined;
      return index >= 0 && !unsupportedWorkBotContext(current.slice(0, index + 1)) && (!cloudTeam || Boolean(member && member.leftAt === undefined));
    };
    const offer = await offerWorkBot(route.sourceBotId, threadId, source.text, owner, messageId, signal, mayContinue);
    if (!mayContinue()) return { interrupted: true };
    return offer?.state === "pending" ? { requestId: offer.requestId } : null;
  },
  mainTarget: (threadId, messageId) => {
    const source = store.messagesFor(threadId).find(message => message.id === messageId);
    const botId = source?.workBotRouting?.sourceBotId;
    const bot = botId && store.bot(botId);
    return bot && !bot.hidden && bot.defaultBot && (defaultBotPerson(bot) ? personKey({ id: "", email: defaultBotPerson(bot) }) : "") === source?.workBotRouting?.ownerKey && store.taskByThread(bot.id, threadId) ? { botId: bot.id, threadId } : null;
  },
  decision: async (threadId, messageId, requestId) => {
    const source = store.messagesFor(threadId).find(row => row.id === messageId);
    const route = source?.workBotRouting;
    const card = store.messagesFor(threadId).find(row => row.card?.requestId === requestId)?.card;
    const request = card?.teamSetupRequest;
    if (!route?.sourceBotId || !card || request?.workBotOffer?.sourceMessageId !== messageId) return { state: "interrupted" };
    if (!card.answered && !card.dismissed && !card.expired) return { state: "pending" };
    if (card.answered === "deny" && request.result?.state === "denied") return { state: "chosen", target: { botId: route.sourceBotId, threadId } };
    if (card.answered === "allow" && request.result?.state === "applied") {
      const created = request.result.bots.find(bot => bot.action === "created");
      const operation = request.operations.find(item => item.action === "create" && item.botId === created?.id);
      const bot = created && store.bot(created.id);
      if (bot && !bot.hidden && operation?.threadId && store.taskByThread(bot.id, operation.threadId)) return { state: "chosen", target: { botId: bot.id, threadId: operation.threadId } };
    }
    return { state: "interrupted" };
  },
  dispatch: async (threadId, messageId, target) => {
    const source = store.messagesFor(threadId).find(row => row.id === messageId);
    const route = source?.workBotRouting;
    const original = route?.sourceBotId ? store.bot(route.sourceBotId) : null;
    const owner = original?.defaultBot ? defaultBotPerson(original) : undefined;
    if (!source?.text || !route?.sourceBotId || !route.triggerKind || !route.modelSelection || !original || owner === undefined || route.ownerKey !== (owner ? personKey({ id: "", email: owner }) : "") || !sameModelSelection(store.projectBotForTask(route.sourceBotId, threadId)?.modelSelection, route.modelSelection) || !sameModelSelection(store.projectBotForTask(target.botId, target.threadId)?.modelSelection, route.modelSelection) || !store.activePath(threadId).some(row => row.id === messageId)) throw new Error("Work bot request is no longer available");
    const person = source.sender?.id;
    const teamPerson = person ? teamPersonFor(person) : undefined;
    const session = person ? sessionFor(person) : undefined;
    const email = teamPerson?.email ?? session?.email;
    if (cloudTeam && (!person || !teamPerson || teamPerson.leftAt !== undefined)) throw new Error("The requesting person is no longer available");
    const trigger: UsageTrigger = { kind: route.triggerKind, ...(email ? { email } : {}) };
    if (target.botId === route.sourceBotId && target.threadId === threadId) {
      const replyTo = source.replyToId ? store.messagesFor(threadId).find(row => row.id === source.replyToId) : undefined;
      if (source.replyToId && !replyTo) throw new Error("The replied-to message is no longer available");
      await startTurn(target.botId, source.text, { threadId, userMessage: source, sender: source.sender, trigger, replyTo, dataContext: source.dataContext, allowRoomTurnElsewhere: true, workBotRoutingMessageId: messageId });
    } else {
      if (sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) throw new Error("This conversation cannot be handed off safely");
      if (threadBusy(target.botId, target.threadId)) throw new Error("The target conversation is already in use");
      workBotTargetLocks.set(target.threadId, { sourceThreadId: threadId, messageId });
      try {
        if (store.messagesFor(target.threadId).some(row => row.role === "user" || row.workBotCopy)) throw new Error("The target conversation is already in use");
        const sourceAudience = teamHost.audienceOf(threadId);
        const sourcePerson = audienceMember(sourceAudience);
        if (sourcePerson && conversationShares.isShareKey(sourcePerson)) throw new Error("This shared conversation cannot be handed off safely");
        if (cloudTeam && sourcePerson && !threadStarters.get(target.threadId)) {
          if (store.messagesFor(target.threadId).length) throw new Error("The target conversation is already in use");
          threadStarters.setRequired(target.threadId, sourcePerson);
        }
        const sourceLeaf = store.activeLeaf(threadId);
        const targetLeaf = store.activeLeaf(target.threadId);
        const validateHandoff = () => {
          assertAvailable();
          const currentSource = store.messagesFor(threadId).find(message => message.id === messageId);
          const from = store.bot(route.sourceBotId!);
          const to = store.bot(target.botId);
          if (sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) throw new Error("This conversation cannot be handed off safely");
          const member = person ? teamPersonFor(person) : undefined;
          if (!mayDispatchWorkBot(cloudTeam, member, from, to)) throw new Error("The requesting person's bot access changed");
          const accessMatches = from?.access && to?.access ? sameAccess(from.access, to.access) : !from?.access && !to?.access;
          if (currentSource?.workBotRouting?.state !== "dispatching" || currentSource.text !== source.text || store.activeLeaf(threadId) !== sourceLeaf || store.activeLeaf(target.threadId) !== targetLeaf || !from || !to || to.hidden || !store.taskByThread(target.botId, target.threadId) || !sameAudience(from.visibility, to.visibility) || !accessMatches || !mayRead(teamHost.audienceOf(threadId), teamHost.audienceOf(target.threadId)) || !sameModelSelection(store.projectBotForTask(route.sourceBotId!, threadId)?.modelSelection, route.modelSelection) || !sameModelSelection(store.projectBotForTask(target.botId, target.threadId)?.modelSelection, route.modelSelection)) throw new Error("The conversation or its access changed during handoff");
        };
        validateHandoff();
        const path = sinceFreshStart(store.activePath(threadId));
        const sourceIndex = path.findIndex(row => row.id === messageId);
        if (sourceIndex < 0) throw new Error("Work bot request is no longer in the active context");
        if (unsupportedWorkBotContext(path.slice(0, sourceIndex + 1))) throw new Error("The conversation context cannot be transferred safely to another bot");
        const validateContext = captureWorkBotContext(path, () => sinceFreshStart(store.activePath(threadId)), sourceIndex);
        const staged: Parameters<typeof store.appendWorkBotContext>[1] = [];
        for (let index = 0; index < sourceIndex; index += 1) {
          if (index > 0 && index % 100 === 0) {
            await new Promise<void>(resolve => setImmediate(resolve));
          }
          const row = path[index]!;
          if (row.kind !== "text" || !row.text || (row.role !== "user" && row.role !== "bot")) continue;
          const from = row.role === "bot" ? row.from ?? { botId: original.id, name: original.name, color: original.color } : undefined;
          staged.push({ sourceId: row.id, ...(row.replyToId ? { replySourceId: row.replyToId } : {}), message: {
            role: row.role, kind: "text", text: row.text, at: row.at,
            workBotCopy: { sourceThreadId: threadId, sourceMessageId: row.id, requestMessageId: messageId,
              status: row.requestCancelled ? "cancelled" : row.requestPending === true ? "unsettled" : row.requestPending === false ? "settled" : "unknown" },
            ...(row.sender ? { sender: row.sender } : {}), ...(from ? { from } : {}), ...(row.attachments ? { attachments: row.attachments } : {}),
          } });
        }
        if (source.replyToId && !staged.some(row => row.sourceId === source.replyToId)) throw new Error("The replied-to message is no longer available");
        validateHandoff();
        await startTurn(target.botId, source.text, { threadId: target.threadId, sendId: `workbot-${messageId}`, sender: source.sender, trigger, dataContext: source.dataContext, allowRoomTurnElsewhere: true, workBotRoutingMessageId: messageId, prepareWorkBotContext: () => {
          validateHandoff();
          validateContext();
          const copied = store.appendWorkBotContext(target.threadId, [...staged, { sourceId: messageId, ...(source.replyToId ? { replySourceId: source.replyToId } : {}), message: {
            role: "user", kind: "text", text: source.text, at: Date.now(), sendId: `workbot-${messageId}`,
            ...(source.sender ? { sender: source.sender } : {}), ...(source.dataContext ? { dataContext: source.dataContext } : {}),
          } }]);
          return { userMessage: copied.get(messageId)!, ...(source.replyToId ? { replyTo: copied.get(source.replyToId) } : {}) };
        } });
      } finally {
        if (workBotTargetLocks.get(target.threadId)?.messageId === messageId) workBotTargetLocks.delete(target.threadId);
        queueMicrotask(drainQueuedSends);
      }
    }
  },
  report: error => console.warn("Work bot routing could not complete", error instanceof Error ? error.name : "unknown error"),
});

  return { workBotRouter, reconcileWorkBotBranch, workBotRoutingBlocks };
}
