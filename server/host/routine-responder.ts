import type { ServerResponse } from "node:http";
import type { RoutineRequestService } from "../routine-requests.ts";
import type { Store } from "../store.ts";
import { json } from "../harness/http.ts";

export function createRoutineResponder(store: Store) {
function sendRoutineResolution(
  res: ServerResponse,
  result: ReturnType<RoutineRequestService["resolve"]>,
): boolean {
  if (!result.claimed) return false;
  if (result.state === "invalid") {
    json(res, result.status, { error: result.error });
    return true;
  }
  if (result.state === "already_settled") {
    json(res, 200, {
      ok: true,
      outcome: result.behavior === "allow" ? "allowed-once" : result.behavior === "deny" ? "rejected" : "unavailable",
      alreadySettled: true,
    });
    return true;
  }
  if (result.state === "denied") {
    json(res, 200, { ok: true, outcome: "rejected" });
    return true;
  }
  json(res, 200, {
    ok: true,
    outcome: "allowed-once",
    routineAction: result.action,
    resultId: result.resultId,
  });
  return true;
}
/** Routine changes apply on their own since Triggers v2; a card left open from before is expired, never confirmed. */
function resolveAndSendRoutine(res: ServerResponse, args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string }): boolean {
  const message = store.messagesFor(args.threadId).find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.routineRequest);
  if (!message?.card) return false;
  if (message.card.answered) return sendRoutineResolution(res, { claimed: true, state: "already_settled", behavior: message.card.answered });
  store.patchMessage(args.threadId, message.id, { card: { ...message.card, expired: true, options: [] } });
  json(res, 410, { error: "This routine request is from before triggers applied on their own. Ask the bot again and it will set it up directly." });
  return true;
}
  return resolveAndSendRoutine;
}
