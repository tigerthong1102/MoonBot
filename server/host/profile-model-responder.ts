import type { ServerResponse } from "node:http";
import type { BotRecord, Store } from "../store.ts";
import type { WireBot } from "../../shared/wire.ts";
import type { ProfileRequestService } from "../profile-requests.ts";
import type { ModelRequestService } from "../model-requests.ts";
import { appendDecision } from "../decision-log.ts";
import { json } from "../harness/http.ts";

export function createProfileModelResponder(deps: {
  store: Store;
  profileRequests: ProfileRequestService;
  modelRequests: ModelRequestService;
  dataDir: string;
  broadcast(payload: Record<string, unknown>): void;
  wireBot(bot: BotRecord): WireBot;
}) {
  const { store, profileRequests, modelRequests, dataDir, broadcast, wireBot } = deps;
function resolveAndSendProfile(
  res: ServerResponse,
  args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string },
): boolean {
  const card = store.messagesFor(args.threadId).find(
    (message) => message.card?.requestId === args.requestId && message.card.profileRequest,
  )?.card;
  if (!card) return false;
  const result = profileRequests.resolve(args);
  if (!result.claimed) return false;
  if (result.state === "applied" || result.state === "denied") {
    appendDecision(dataDir, {
      threadId: args.threadId, requestId: args.requestId, botId: args.botId, botName: args.botName,
      tool: "update_profile", summary: card.subtitle,
      decision: result.state === "applied" ? "user-approved" : "user-denied", source: "user",
    });
  }
  if (result.state === "applied") {
    const target = store.bot(result.targetBotId);
    if (target) broadcast({ kind: "bot", bot: wireBot(target) });
    json(res, 200, {
      ok: true, outcome: "allowed-once", profileFields: result.fields,
      ...(result.settlementPending ? { settlementPending: true, message: result.message } : {}),
    });
    return true;
  }
  if (result.state === "invalid") { json(res, result.status, { error: result.error }); return true; }
  if (result.state === "already_settled") {
    json(res, 200, { ok: true, outcome: result.behavior === "allow" ? "allowed-once" : "rejected", alreadySettled: true });
    return true;
  }
  json(res, 200, { ok: true, outcome: "rejected" });
  return true;
}

function resolveAndSendModel(
  res: ServerResponse,
  args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string },
): boolean {
  const card = store.messagesFor(args.threadId).find(
    (message) => message.card?.requestId === args.requestId && message.card.modelRequest,
  )?.card;
  if (!card) return false;
  const result = modelRequests.resolve(args);
  if (!result.claimed) return false;
  if (result.state === "applied" || result.state === "denied") {
    appendDecision(dataDir, {
      threadId: args.threadId, requestId: args.requestId, botId: args.botId, botName: args.botName,
      tool: "update_model", summary: card.subtitle,
      decision: result.state === "applied" ? "user-approved" : "user-denied", source: "user",
    });
  }
  if (result.state === "applied") {
    const target = store.bot(result.targetBotId);
    if (target) broadcast({ kind: "bot", bot: wireBot(target) });
    json(res, 200, {
      ok: true, outcome: "allowed-once",
      ...(result.settlementPending ? { settlementPending: true, message: result.message } : {}),
    });
    return true;
  }
  if (result.state === "invalid") { json(res, result.status, { error: result.error }); return true; }
  if (result.state === "already_settled") {
    json(res, 200, { ok: true, outcome: result.behavior === "allow" ? "allowed-once" : "rejected", alreadySettled: true });
    return true;
  }
  json(res, 200, { ok: true, outcome: "rejected" });
  return true;
}

  return { resolveAndSendProfile, resolveAndSendModel };
}
