import type { ServerResponse } from "node:http";
import type { BotRecord, Store } from "../store.ts";
import type { TeamSetupRequestService } from "../team-setup-requests.ts";
import type { TeamSetupRequest } from "../../shared/team-setup.ts";
import type { WorkBotRouter } from "../work-bot-routing.ts";
import type { Audience } from "../audience.ts";
import { audienceMember } from "../audience.ts";
import { sinceFreshStart } from "../fresh-start.ts";
import { serverLine } from "../server-lines.ts";
import { json } from "../harness/http.ts";
import { appendDecision } from "../decision-log.ts";
import { unsupportedWorkBotContext } from "../work-bot-context.ts";
import { portableWorkBotUpload } from "../message-db.ts";
import { extractHandoffMedia } from "../turn-images.ts";
import { verifyPortableFiles } from "../work-bot-upload-context.ts";
import { workBotQueuedMessage, workBotQueuedFollowups, safeWorkBotFollowups } from "../steer-queue.ts";

export function createTeamSetupResponder(deps: {
  store: Store;
  availableData(botId: string, cardId: string): boolean;
  preflightData(botId: string, ids: readonly string[]): Promise<boolean>;
  workBotChoiceLocks: Set<string>;
  assertAvailable(botId?: string, threadId?: string): void;
  cloudTeam: boolean;
  sharedNonTeam(): boolean;
  teamHost: { audienceOf(threadId: string): Audience };
  threadLanguage(threadId: string): string | undefined;
  assertTeamComputerChangeIdle(before: BotRecord, after: BotRecord): void;
  teamSetupRequests: TeamSetupRequestService;
  workBotRouter: WorkBotRouter;
  dataDir: string;
  answerCardNode(threadId: string, messageId: string, text: string): boolean;
  teamSetupDecisionText(request: TeamSetupRequest): string;
}) {
  const { store, workBotChoiceLocks, assertAvailable, cloudTeam, sharedNonTeam, teamHost, threadLanguage, assertTeamComputerChangeIdle, teamSetupRequests, workBotRouter, dataDir, answerCardNode, teamSetupDecisionText } = deps;
async function resolveAndSendTeamSetup(res: ServerResponse, args: { botId: string; threadId: string; requestId: string; behavior: string }, ownerReview: boolean): Promise<boolean> {
  const card = store.messagesFor(args.threadId).find((item) => item.card?.requestId === args.requestId && item.card.teamSetupRequest)?.card;
  if (!card) return false;
  if (card.teamSetupRequest?.workBotOffer?.sourceMessageId && store.messagesFor(args.threadId).some(row => row.id === card.teamSetupRequest?.workBotOffer?.sourceMessageId && row.workBotRouting)) {
    if (args.behavior === "allow") assertAvailable(args.botId, args.threadId);
    else assertAvailable();
  }
  if (args.behavior === "allow" && !ownerReview) { json(res, 403, { error: "Approve team setup or deletion from the desktop app or a paired Full-access device. In a local browser, wait until every bot is idle." }); return true; }
  if (args.behavior === "allow" && card.teamSetupRequest?.workBotOffer && !store.messagesFor(args.threadId).some(row => row.id === card.teamSetupRequest?.workBotOffer?.sourceMessageId && row.workBotRouting)) {
    json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.legacyUnavailable") });
    return true;
  }
  if (args.behavior === "allow" && card.teamSetupRequest?.workBotOffer && (sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(args.threadId))))) {
    json(res, 409, { error: serverLine(threadLanguage(args.threadId), sharedNonTeam() ? "server.workBot.sharedUnavailable" : "server.workBot.privateUnavailable") });
    return true;
  }
  if (args.behavior === "allow" && !card.answered && !card.dismissed && !card.expired && card.teamSetupRequest?.workBotOffer) {
    const path = sinceFreshStart(store.activePath(args.threadId));
    const sourceIndex = path.findIndex(row => row.id === card.teamSetupRequest?.workBotOffer?.sourceMessageId);
    const history = path.slice(0, sourceIndex + 1);
    const portable = (row: (typeof history)[number]) => portableWorkBotUpload(args.threadId, row);
    const portableData = (row: (typeof history)[number]) => Boolean(row.role === "user" && row.kind === "text" && row.dataContext && deps.availableData(args.botId, row.dataContext.cardId));
    const unsupported = sourceIndex >= 0 && unsupportedWorkBotContext(history, row => portable(row)?.prose, portableData);
    if (unsupported) {
      json(res, 409, { error: serverLine(threadLanguage(args.threadId), unsupported === "data" ? "server.workBot.dataUnavailable" : "server.workBot.fileUnavailable") });
      return true;
    }
    const queue = () => workBotQueuedFollowups(args.botId, args.threadId, card.teamSetupRequest!.workBotOffer!.sourceMessageId!);
    const queued = queue();
    const queueSnapshot = JSON.stringify(queued);
    const inputs = [...history, ...queued.map(workBotQueuedMessage)];
    const dataIds = inputs.flatMap(row => row.dataContext ? [row.dataContext.cardId] : []);
    if (dataIds.length && !await deps.preflightData(args.botId, dataIds)) {
      json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.dataUnavailable") });
      return true;
    }
    const files = inputs.flatMap(row => portable(row)?.files ?? []);
    if (files.length) {
      try {
        const validate = await verifyPortableFiles(files);
        validate();
      } catch {
        json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.fileUnavailable") });
        return true;
      }
    }
    if (files.length || dataIds.length) {
      assertAvailable(args.botId, args.threadId);
      const current = sinceFreshStart(store.activePath(args.threadId));
      if (sharedNonTeam() || (cloudTeam && audienceMember(teamHost.audienceOf(args.threadId))) || history.some((row, index) => current[index] !== row) || unsupportedWorkBotContext(current.slice(0, sourceIndex + 1), row => portable(row)?.prose, portableData)) {
        json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.pendingUnavailable") });
        return true;
      }
    }
    const source = sourceIndex >= 0 ? path[sourceIndex] : undefined;
    if (source && queued.length && files.length) extractHandoffMedia(source.text ?? "", queued.map(item => item.text));
    if (!source || JSON.stringify(queue()) !== queueSnapshot || !safeWorkBotFollowups(args.botId, args.threadId, source, portableData)) {
      json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.pendingUnavailable") });
      return true;
    }
  }
  if (args.behavior === "allow" && !card.answered && !card.dismissed && !card.expired) {
    for (const operation of card.teamSetupRequest!.operations) {
      const before = store.bot(operation.botId);
      if (before && operation.action === "update") assertTeamComputerChangeIdle(before, { ...before, ...operation.fields });
    }
  }
  const shouldLock = args.behavior === "allow" && Boolean(card.teamSetupRequest?.workBotOffer) && !card.answered;
  if (shouldLock && workBotChoiceLocks.has(args.threadId)) { json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.pendingUnavailable") }); return true; }
  if (shouldLock) workBotChoiceLocks.add(args.threadId);
  try {
  const resolved = await teamSetupRequests.resolve(args);
  if (!resolved) return false;
  const sourceMessageId = resolved.request.workBotOffer?.sourceMessageId;
  if (sourceMessageId) await workBotRouter.reconcileChoice(args.threadId, sourceMessageId);
  if (!resolved.duplicate) {
    appendDecision(dataDir, { threadId: args.threadId, requestId: args.requestId, botId: args.botId, tool: card.tool,
      summary: card.subtitle, decision: resolved.result.state === "applied" ? "user-approved" : "user-denied", source: "user" });
  }
  const current = store.messagesFor(args.threadId).find((item) => item.id === resolved.messageId);
  if (!resolved.request.workBotOffer && current?.card?.teamSetupRequest?.result && !current.card.teamSetupRequest.resumed) {
    if (answerCardNode(args.threadId, current.id, teamSetupDecisionText(resolved.request))) {
      store.patchMessage(args.threadId, current.id, { card: { ...current.card, teamSetupRequest: { ...current.card.teamSetupRequest, resumed: true } } });
    }
  }
  const cleanupFailed = Boolean(sourceMessageId && workBotRouter.hasCleanupFailure(args.threadId, sourceMessageId));
  const routingState = sourceMessageId ? (cleanupFailed ? "interrupted" : store.messagesFor(args.threadId).find(row => row.id === sourceMessageId)?.workBotRouting?.state) : undefined;
  json(res, 200, { ok: true, outcome: resolved.result.state === "applied" ? "allowed-once" : "rejected", result: resolved.result, alreadySettled: resolved.duplicate, ...(routingState ? { routingState } : {}), ...(cleanupFailed ? { settlementPending: true, message: serverLine(threadLanguage(args.threadId), "server.workBot.restartToRecover") } : {}) });
  return true;
  } finally { if (shouldLock) workBotChoiceLocks.delete(args.threadId); }
}

  return resolveAndSendTeamSetup;
}
