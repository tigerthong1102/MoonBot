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

export function createTeamSetupResponder(deps: {
  store: Store;
  assertAvailable(): void;
  cloudTeam: boolean;
  teamHost: { audienceOf(threadId: string): Audience };
  threadLanguage(threadId: string): string | undefined;
  assertTeamComputerChangeIdle(before: BotRecord, after: BotRecord): void;
  teamSetupRequests: TeamSetupRequestService;
  workBotRouter: WorkBotRouter;
  dataDir: string;
  answerCardNode(threadId: string, messageId: string, text: string): boolean;
  teamSetupDecisionText(request: TeamSetupRequest): string;
}) {
  const { store, assertAvailable, cloudTeam, teamHost, threadLanguage, assertTeamComputerChangeIdle, teamSetupRequests, workBotRouter, dataDir, answerCardNode, teamSetupDecisionText } = deps;
async function resolveAndSendTeamSetup(res: ServerResponse, args: { botId: string; threadId: string; requestId: string; behavior: string }, ownerReview: boolean): Promise<boolean> {
  const card = store.messagesFor(args.threadId).find((item) => item.card?.requestId === args.requestId && item.card.teamSetupRequest)?.card;
  if (!card) return false;
  if (card.teamSetupRequest?.workBotOffer?.sourceMessageId && store.messagesFor(args.threadId).some(row => row.id === card.teamSetupRequest?.workBotOffer?.sourceMessageId && row.workBotRouting)) {
    assertAvailable();
  }
  if (args.behavior === "allow" && !ownerReview) { json(res, 403, { error: "Approve team setup or deletion from the desktop app or a paired Full-access device. In a local browser, wait until every bot is idle." }); return true; }
  if (args.behavior === "allow" && card.teamSetupRequest?.workBotOffer && !store.messagesFor(args.threadId).some(row => row.id === card.teamSetupRequest?.workBotOffer?.sourceMessageId && row.workBotRouting)) {
    json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.legacyUnavailable") });
    return true;
  }
  if (args.behavior === "allow" && cloudTeam && card.teamSetupRequest?.workBotOffer && audienceMember(teamHost.audienceOf(args.threadId))) {
    json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.privateUnavailable") });
    return true;
  }
  if (args.behavior === "allow" && card.teamSetupRequest?.workBotOffer) {
    const path = sinceFreshStart(store.activePath(args.threadId));
    const sourceIndex = path.findIndex(row => row.id === card.teamSetupRequest?.workBotOffer?.sourceMessageId);
    if (sourceIndex >= 0 && path.slice(0, sourceIndex + 1).some(row => row.dataContext)) {
      json(res, 409, { error: serverLine(threadLanguage(args.threadId), "server.workBot.dataUnavailable") });
      return true;
    }
  }
  if (args.behavior === "allow" && !card.answered && !card.dismissed && !card.expired) {
    for (const operation of card.teamSetupRequest!.operations) {
      const before = store.bot(operation.botId);
      if (before && operation.action === "update") assertTeamComputerChangeIdle(before, { ...before, ...operation.fields });
    }
  }
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
  const routingState = sourceMessageId ? store.messagesFor(args.threadId).find(row => row.id === sourceMessageId)?.workBotRouting?.state : undefined;
  json(res, 200, { ok: true, outcome: resolved.result.state === "applied" ? "allowed-once" : "rejected", result: resolved.result, alreadySettled: resolved.duplicate, ...(routingState ? { routingState } : {}) });
  return true;
}

  return resolveAndSendTeamSetup;
}
