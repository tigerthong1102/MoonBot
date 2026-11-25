import { routedWorkMarker } from "../delta-context.ts";
import { workBotGrantsMatch } from "../work-bot-permissions.ts";
import { parseToolScope, toolScopeWidens } from "../../shared/tool-scope.ts";
import { levelWithin } from "../../shared/approval-mode.ts";
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
import { captureWorkBotContext, scanWorkBotContext, unsupportedWorkBotContext, workBotContextText } from "../work-bot-context.ts";
import { mayDispatchWorkBot, type WorkBotMember } from "../work-bot-access.ts";
import { forgetTransferredWorkBotFollowups, workBotQueuedFollowups } from "../steer-queue.ts";
import { pendingWorkBotTargets } from "../message-db.ts";
import { serverLine } from "../server-lines.ts";

export function cleanupWorkBotSetup(steps: readonly (() => void)[]): boolean {
  let clean = true;
  for (const step of steps) try { step(); } catch { clean = false; }
  return clean;
}

export function updateWorkBotRoutingIndex(idsByThread: Map<string, Set<string>>, threadId: string, messageId: string, state: NonNullable<Message["workBotRouting"]>["state"]): void {
  const ids = idsByThread.get(threadId) ?? new Set<string>();
  if (state === "classifying" || state === "waiting_choice" || state === "dispatching") { ids.add(messageId); idsByThread.set(threadId, ids); }
  else { ids.delete(messageId); if (!ids.size) idsByThread.delete(threadId); }
}

type TargetLock = { sourceThreadId: string; messageId: string; cleanupFailed?: boolean };

export function cancelWorkBotRoutes(store: Store, locks: Map<string, TargetLock>, router: WorkBotRouter, index: (threadId: string, messageId: string, state: NonNullable<Message["workBotRouting"]>["state"]) => void, threadId: string): void {
  for (const lock of locks.values()) {
    if (lock.sourceThreadId !== threadId && locks.get(threadId) !== lock) continue;
    if (lock.cleanupFailed) continue;
    const source = store.messagesFor(lock.sourceThreadId).find(row => row.id === lock.messageId);
    if (source?.workBotRouting?.state === "dispatching") {
      store.patchMessage(lock.sourceThreadId, lock.messageId, { workBotRouting: { ...source.workBotRouting, state: "cancelled" }, requestCancelled: true });
      index(lock.sourceThreadId, lock.messageId, "cancelled");
    }
  }
  for (const message of store.activePath(threadId)) {
    if (!message.workBotRouting || !router.cancel(threadId, message.id)) continue;
    store.patchMessage(threadId, message.id, { requestCancelled: true });
    const card = store.messagesFor(threadId).find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === message.id);
    if (card?.card && !card.card.answered) store.patchMessage(threadId, card.id, { card: { ...card.card, dismissed: true } });
  }
}

export function assertWorkBotStopAllowed(choices: Set<string>, locks: Map<string, TargetLock>, language: string | undefined, threadId: string): void {
  if (choices.has(threadId)) throw Object.assign(new Error(serverLine(language, "server.workBot.choiceInProgress")), { status: 409 });
  if ([...locks].some(([target, lock]) => lock.cleanupFailed && (target === threadId || lock.sourceThreadId === threadId))) throw Object.assign(new Error(serverLine(language, "server.workBot.restartToRecover")), { status: 409 });
}

export function handedRunTarget(store: Store, busy: (botId: string, threadId: string) => boolean, ownerFor: (threadId: string) => { messageId?: string; stopped?: boolean } | undefined, botId: string, threadId: string): { botId: string; threadId: string } | null {
  const lastUser = store.activePath(threadId).findLast(row => row.role === "user");
  const handed = lastUser?.workBotRouting;
  if (lastUser && !busy(botId, threadId) && handed?.state === "dispatched" && handed.targetThreadId && handed.targetBotId && handed.targetThreadId !== threadId) {
    const targetOwner = ownerFor(handed.targetThreadId);
    const handedMessage = store.messagesFor(handed.targetThreadId).find(row => row.sendId === `workbot-${lastUser.id}`);
    if (handedMessage && targetOwner?.messageId === handedMessage.id && !targetOwner.stopped) return { botId: handed.targetBotId, threadId: handed.targetThreadId };
  }
  return null;
}

export function hasUncertainWorkBotStop(rows: readonly Message[], sendId: string | undefined, isTypedStop: boolean): boolean {
  return rows.some(row => {
    const pending = row.workBotRouting?.stopPending;
    return Boolean(pending && ((sendId && pending.sendId === sendId) || (isTypedStop && (!sendId || !pending.sendId))));
  });
}

export function unambiguousWorkBotRequest(path: readonly Message[], ownerMessageId: string | undefined, verified: (message: Message) => boolean): boolean {
  if (!ownerMessageId) return false;
  const index = path.findIndex(message => message.id === ownerMessageId && message.role === "user");
  if (index < 0) return false;
  const source = path[index]!.workBotHandoffSource;
  return !path.slice(index + 1).some(message => message.role === "user" && (!source || message.workBotHandoffSource?.threadId !== source.threadId || message.workBotHandoffSource.messageId !== source.messageId || !verified(message)));
}

export function pendingWorkBotOfferSource(store: Store, pending: Map<string, Set<string>>, locks: Set<string>, threadId: string, sender: Message["sender"], cloudTeam: boolean, language: string | undefined): string | undefined {
  const ids = pending.get(threadId), rows = store.messagesFor(threadId);
  if (locks.has(threadId) || (ids && rows.some(row => ids.has(row.id) && row.workBotRouting?.state === "dispatching" && row.workBotRouting.targetThreadId !== threadId))) throw Object.assign(new Error(serverLine(language, "server.workBot.choiceInProgress")), { status: 409, code: "work_bot_handoff_in_progress" });
  const source = ids?.size === 1 ? rows.find(row => ids.has(row.id) && (row.workBotRouting?.state === "classifying" || row.workBotRouting?.state === "waiting_choice")) : undefined;
  return source && source.sender?.id === sender?.id && (!cloudTeam || sender?.id) ? source.id : undefined;
}

export function releaseWorkBotTargetLock(locks: Map<string, TargetLock>, threadId: string, messageId: string, settled: (threadId: string) => void): void {
  const lock = locks.get(threadId);
  if (lock?.messageId !== messageId) return;
  locks.delete(threadId);
  try { settled(threadId); } catch (error) {
    locks.set(threadId, { ...lock, cleanupFailed: true });
    throw Object.assign(error instanceof Error ? error : new Error("Work bot completion fence failed"), { workBotCleanupFailed: true });
  }
}

export function createWorkBotHost(deps: {
  store: Store;
  pendingWorkBotIds: Map<string, Set<string>>;
  workBotTargetLocks: Map<string, TargetLock>;
  indexWorkBotRouting(threadId: string, messageId: string, state: NonNullable<Message["workBotRouting"]>["state"]): void;
  drainQueuedSends(): void;
  targetUnlocked(threadId: string): void;
  assertAvailable(botId?: string, threadId?: string): void;
  offerWorkBot(botId: string, threadId: string, text: string, owner: string, messageId: string, signal?: AbortSignal, mayContinue?: () => boolean, contextBlock?: () => "files" | "data" | undefined): ReturnType<TeamSetupRequestService["offerFromChat"]> | undefined;
  teamPersonFor(person: string): WorkBotMember | undefined;
  sessionFor(person: string): { email?: string } | undefined;
  cloudTeam: boolean;
  sharedNonTeam(): boolean;
  teamHost: { audienceOf(threadId: string): Audience };
  conversationShares: { isShareKey(person: string): boolean };
  threadStarters: { get(threadId: string): string | undefined; setRequired(threadId: string, person: string): void };
  threadBusy(botId: string, threadId: string): boolean;
  approvalMode(botId: string, threadId: string): import("../../shared/approval-mode.ts").ApprovalMode;
  shouldHold(sourceBotId: string, sourceThreadId: string, targetBotId: string): boolean;
  startTurn(botId: string, text: string, opts: { threadId: string; userMessage?: Message; sender?: Message["sender"]; trigger: UsageTrigger; replyTo?: ReplyTarget; dataContext?: Message["dataContext"]; sendId?: string; allowRoomTurnElsewhere: true; workBotRoutingMessageId: string; prepareWorkBotContext?: () => { userMessage: Message; replyTo?: ReplyTarget; transferredText?: string[]; transferredMessageIds?: string[] } }): Promise<unknown>;
}) {
  const { store, pendingWorkBotIds, workBotTargetLocks, indexWorkBotRouting, drainQueuedSends, targetUnlocked, assertAvailable, offerWorkBot, teamPersonFor, sessionFor, cloudTeam, sharedNonTeam, teamHost, conversationShares, threadStarters, threadBusy, startTurn } = deps;
function annotateOfferContext(threadId: string, messageId: string, requestId: string): void {
  const current = sinceFreshStart(store.activePath(threadId)), index = current.findIndex(row => row.id === messageId);
  const blocked = index < 0 ? null : unsupportedWorkBotContext(current.slice(0, index + 1));
  const offerMessage = store.messagesFor(threadId).find(row => row.card?.requestId === requestId);
  const card = offerMessage?.card, request = card?.teamSetupRequest;
  if (card && request?.workBotOffer && request.workBotOffer.contextBlock !== (blocked ?? undefined)) store.patchMessage(threadId, offerMessage!.id, { card: { ...card, teamSetupRequest: { ...request, workBotOffer: { ...request.workBotOffer, contextBlock: blocked ?? undefined } } } });
}
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

const workBotRouter = new WorkBotRouter({
  message: (threadId, messageId) => store.messagesFor(threadId).find(message => message.id === messageId),
  blockCleanupFailure: (threadId, messageId, route, heldCommitted) => {
    if (route.targetThreadId) workBotTargetLocks.set(route.targetThreadId, { sourceThreadId: threadId, messageId, cleanupFailed: true });
    const current = store.messagesFor(threadId).find(row => row.id === messageId);
    if (!heldCommitted && current?.workBotRouting?.state === "dispatching") store.patchMessage(threadId, messageId, { workBotRouting: { ...current.workBotRouting, recoveryBlocked: true } });
  },
  recoverDispatch: (_threadId, messageId, route) => {
    if (!route.targetBotId || !route.targetThreadId) return route.state === "dispatching";
    const target = store.messagesFor(route.targetThreadId).find(row => row.id === messageId || row.sendId === `workbot-${messageId}`);
    if (route.state !== "dispatching" && target?.requestPending !== true && !target?.workBotRecoveryPending) return false;
    if (target) {
      const group = store.messagesFor(route.targetThreadId).filter(row => row.id === target.id || (row.workBotHandoffSource?.threadId === _threadId && row.workBotHandoffSource.messageId === messageId));
      for (const row of group) if (!store.patchMessage(route.targetThreadId, row.id, { workBotExecutionUncertain: true })) return false;
    }
    if (target && !store.patchTask(route.targetBotId, route.targetThreadId, { resumeCursors: {}, rewound: true })) return false;
    return true;
  },
  finishRecovery: (_threadId, messageId, route) => {
    if (!route.targetThreadId) return;
    const lock = workBotTargetLocks.get(route.targetThreadId);
    if (lock?.messageId === messageId && lock.cleanupFailed) return;
    const target = store.messagesFor(route.targetThreadId).find(row => row.id === messageId || row.sendId === `workbot-${messageId}`);
    if (target?.workBotExecutionUncertain) {
      const group = store.messagesFor(route.targetThreadId).filter(row => row.id === target.id || (row.workBotExecutionUncertain && row.workBotHandoffSource?.threadId === _threadId && row.workBotHandoffSource.messageId === messageId));
      for (const row of group) if (!store.patchMessage(route.targetThreadId, row.id, { ...(row.id === target.id ? { requestPending: false } : {}), workBotRecoveryPending: undefined })) return;
    }
    if (lock?.messageId === messageId) workBotTargetLocks.delete(route.targetThreadId);
  },
  patch: (threadId, messageId, expected, routing) => {
    const message = store.messagesFor(threadId).find(row => row.id === messageId);
    if (!message || message.workBotRouting?.state !== expected) return false;
    if (!store.activePath(threadId).some(row => row.id === messageId)) {
      const updated = store.patchMessage(threadId, messageId, { workBotRouting: { ...message.workBotRouting, state: "interrupted", recoveryBlocked: undefined } });
      indexWorkBotRouting(threadId, messageId, "interrupted");
      queueMicrotask(drainQueuedSends);
      return routing.state === "interrupted" && Boolean(updated);
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
    if (sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId))) || deps.approvalMode(route.sourceBotId, threadId) === "custom") return null;
    const path = sinceFreshStart(store.activePath(threadId));
    const sourceIndex = path.findIndex(row => row.id === messageId);
    if (sourceIndex < 0) return { interrupted: true };
    await scanWorkBotContext(path.slice(0, sourceIndex + 1), signal);
    if (signal.aborted || sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) return { interrupted: true };
    const previous = store.messagesFor(threadId).find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === messageId && row.card.requestId);
    if (previous?.card?.requestId) {
      if (!store.activePath(threadId).some(row => row.id === previous.id)) return { interrupted: true };
      annotateOfferContext(threadId, messageId, previous.card.requestId);
      return { requestId: previous.card.requestId };
    }
    const mayContinue = () => {
      if (signal.aborted || sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) return false;
      const current = sinceFreshStart(store.activePath(threadId));
      const index = current.findIndex(row => row.id === messageId);
      const person = source.sender?.id, member = person ? teamPersonFor(person) : undefined;
      return index >= 0 && (!cloudTeam || Boolean(member && member.leftAt === undefined));
    };
    const offer = await offerWorkBot(route.sourceBotId, threadId, source.text, owner, messageId, signal, mayContinue, () => {
      const current = sinceFreshStart(store.activePath(threadId)), index = current.findIndex(row => row.id === messageId);
      return index < 0 ? undefined : unsupportedWorkBotContext(current.slice(0, index + 1)) ?? undefined;
    });
    if (!mayContinue()) return { interrupted: true };
    if (offer?.state !== "pending") return null;
    annotateOfferContext(threadId, messageId, offer.requestId);
    return { requestId: offer.requestId };
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
    if (!card.answered && !card.dismissed && !card.expired) { annotateOfferContext(threadId, messageId, requestId); return { state: "pending" }; }
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
      let admitted = false, heldCommitted = false, cleanupError: unknown;
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
          assertAvailable(route.sourceBotId!, threadId);
          const currentSource = store.messagesFor(threadId).find(message => message.id === messageId);
          const from = store.bot(route.sourceBotId!);
          const to = store.bot(target.botId);
          if (sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(threadId)))) throw new Error("This conversation cannot be handed off safely");
          const member = person ? teamPersonFor(person) : undefined;
          if (!mayDispatchWorkBot(cloudTeam, member, from, to)) throw new Error("The requesting person's bot access changed");
          const accessMatches = from?.access && to?.access ? sameAccess(from.access, to.access) : !from?.access && !to?.access;
          const sourcePermission = store.projectBotForTask(route.sourceBotId!, threadId);
          const targetPermission = store.projectBotForTask(target.botId, target.threadId);
          const sourceMode = deps.approvalMode(route.sourceBotId!, threadId);
          const targetMode = deps.approvalMode(target.botId, target.threadId);
          const appsMatch = from && to && workBotGrantsMatch(from, to);
          const permissionMatches = appsMatch && sourcePermission && targetPermission && sourceMode !== "custom" && targetMode !== "custom" && levelWithin(targetMode, sourceMode) && parseToolScope(from?.toolScope).ok && parseToolScope(to?.toolScope).ok && !toolScopeWidens(from?.toolScope, to?.toolScope);
          if (currentSource?.workBotRouting?.state !== "dispatching" || currentSource.text !== source.text || store.activeLeaf(threadId) !== sourceLeaf || store.activeLeaf(target.threadId) !== targetLeaf || !from || !to || to.hidden || !store.taskByThread(target.botId, target.threadId) || !sameAudience(from.visibility, to.visibility) || !accessMatches || !permissionMatches || !mayRead(teamHost.audienceOf(threadId), teamHost.audienceOf(target.threadId)) || !sameModelSelection(store.projectBotForTask(route.sourceBotId!, threadId)?.modelSelection, route.modelSelection) || !sameModelSelection(store.projectBotForTask(target.botId, target.threadId)?.modelSelection, route.modelSelection)) throw new Error("The conversation or its access changed during handoff");
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
          const text = workBotContextText(row, original.name);
          if (!text || (row.role !== "user" && row.role !== "bot")) continue;
          const from = row.role === "bot" ? row.from ?? { botId: original.id, name: original.name, color: original.color } : undefined;
          staged.push({ sourceId: row.id, ...(row.replyToId ? { replySourceId: row.replyToId } : {}), message: {
            role: row.role, kind: "text", text: routedWorkMarker(row) ?? text, at: row.at,
            workBotCopy: { sourceThreadId: threadId, sourceMessageId: row.id, requestMessageId: messageId,
              status: row.requestCancelled ? "cancelled" : row.requestPending === true ? "unsettled" : row.requestPending === false ? "settled" : "unknown" },
            ...(row.sender ? { sender: row.sender } : {}), ...(from ? { from } : {}), ...(row.attachments ? { attachments: row.attachments } : {}),
          } });
        }
        if (source.replyToId && !staged.some(row => row.sourceId === source.replyToId)) throw new Error("The replied-to message is no longer available");
        validateHandoff();
        const prepare = (held: boolean) => {
          validateHandoff();
          validateContext();
          const followups = workBotQueuedFollowups(route.sourceBotId!, threadId, messageId);
          const first = followups[0];
          if (followups.some(item => item.sender?.id !== source.sender?.id || item.trigger?.kind !== route.triggerKind || JSON.stringify(item.trigger ?? null) !== JSON.stringify(first?.trigger ?? null) || item.workBotOfferOwner !== first?.workBotOfferOwner || unsupportedWorkBotContext([{ id: item.messageId, role: "user", kind: "text", at: item.queuedAt, text: item.text, dataContext: item.dataContext }]))) throw new Error("Queued work cannot be transferred safely");
          const queueIds = followups.map(item => item.messageId);
          const rows: Parameters<typeof store.appendWorkBotContext>[1] = [...staged.map(row => held ? { ...row, message: { ...row.message, workBotReviewHold: true as const } } : row), { sourceId: messageId, ...(source.replyToId ? { replySourceId: source.replyToId } : {}), message: {
            role: "user", kind: "text", text: source.text, at: Date.now(), sendId: `workbot-${messageId}`, workBotHandoffSource: { threadId, messageId, botId: route.sourceBotId }, ...(held ? { requestPending: false, workBotReviewHold: true as const } : { workBotRecoveryPending: true as const }),
            ...(source.sender ? { sender: source.sender } : {}), ...(source.dataContext ? { dataContext: source.dataContext } : {}),
          } }, ...followups.map(item => ({ sourceId: item.messageId, message: { role: "user" as const, kind: "text" as const, text: item.text, at: item.queuedAt, queueId: item.messageId, workBotHandoffSource: { threadId, messageId, botId: route.sourceBotId }, ...(held ? { requestPending: false, workBotReviewHold: true as const } : { workBotRecoveryPending: true as const }), ...(item.sendId ? { sendId: item.sendId } : {}), ...(item.sender ? { sender: item.sender } : {}) } }))];
          const copied = store.appendWorkBotContext(target.threadId, rows, first ? { claim: { botId: route.sourceBotId!, sourceThreadId: threadId, sourceMessageId: messageId, queueIds, trigger: first.trigger, offerOwner: first.workBotOfferOwner }, afterCommit: () => forgetTransferredWorkBotFollowups(route.sourceBotId!, threadId, messageId, queueIds) } : undefined, { sourceBotId: route.sourceBotId!, sourceThreadId: threadId, sourceMessageId: messageId, targetBotId: target.botId, targetThreadId: target.threadId }, held ? { expectedSourceLeaf: sourceLeaf } : undefined);
          return { userMessage: copied.get(messageId)!, ...(source.replyToId ? { replyTo: copied.get(source.replyToId) } : {}), ...(followups.length ? { transferredText: followups.map(item => item.text), transferredMessageIds: queueIds.map(id => copied.get(id)!.id) } : {}) };
        };
        if (deps.shouldHold(route.sourceBotId, threadId, target.botId)) {
          prepare(true);
          heldCommitted = true;
          indexWorkBotRouting(threadId, messageId, "held_for_review");
          admitted = true;
        } else {
          await startTurn(target.botId, source.text, { threadId: target.threadId, sendId: `workbot-${messageId}`, sender: source.sender, trigger, dataContext: source.dataContext, allowRoomTurnElsewhere: true, workBotRoutingMessageId: messageId, prepareWorkBotContext: () => prepare(false) });
          admitted = true;
        }
      } catch (error) {
        const lock = workBotTargetLocks.get(target.threadId);
        if (lock?.messageId === messageId && (error as { workBotCleanupFailed?: boolean })?.workBotCleanupFailed) lock.cleanupFailed = true;
        throw error;
      } finally {
        if (admitted) try { releaseWorkBotTargetLock(workBotTargetLocks, target.threadId, messageId, targetUnlocked); }
        catch (error) {
          if (heldCommitted) {
            indexWorkBotRouting(threadId, messageId, "dispatching");
            cleanupError = Object.assign(error instanceof Error ? error : new Error("Held work cleanup failed"), { workBotCleanupFailed: true, workBotHeldCommitted: true });
          } else {
            cleanupError = error;
          }
        }
        queueMicrotask(drainQueuedSends);
      }
      if (cleanupError) throw cleanupError;
      if (heldCommitted) return "held" as const;
    }
  },
  report: error => console.warn("Work bot routing could not complete", error instanceof Error ? error.name : "unknown error"),
});

  function recoverWorkBotTargets(): void {
    for (const pending of pendingWorkBotTargets()) {
      const bot = store.botByThread(pending.threadId), source = pending.message.workBotHandoffSource;
      if (!bot || !source) continue;
      const group = store.messagesFor(pending.threadId).filter(row => row.workBotHandoffSource?.threadId === source.threadId && row.workBotHandoffSource.messageId === source.messageId);
      if (!group.every(row => store.patchMessage(pending.threadId, row.id, { workBotExecutionUncertain: true })) || !store.patchTask(bot.id, pending.threadId, { resumeCursors: {}, rewound: true })) continue;
      for (const row of group) store.patchMessage(pending.threadId, row.id, { ...(row.queueId ? {} : { requestPending: false }), workBotRecoveryPending: undefined });
    }
  }
  return { workBotRouter, reconcileWorkBotBranch, recoverWorkBotTargets, annotateOfferContext, assertAvailable };
}
