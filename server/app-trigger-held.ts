import type { AppTrigger, AppTriggerProblem } from "../shared/app-triggers.ts";
import type { BrokerEvent } from "./app-trigger-broker.ts";

export const LINKED_EVENT_CONFLICT = "Linked bots have overlapping app automations. Review them before this event can run.";
export const EVENT_HISTORY_UNAVAILABLE = "Event history or bot links cannot be checked. Restore access and review the automation before continuing.";

export function isEventHoldProblem(problem: AppTriggerProblem | undefined): boolean {
  return problem?.kind === "error" && (problem.text === LINKED_EVENT_CONFLICT || problem.text === EVENT_HISTORY_UNAVAILABLE);
}

export function heldEventMatches(held: { event?: BrokerEvent; heldBotIds?: string[]; heldTriggerIds?: string[] }, trigger: AppTrigger): boolean {
  if (held.heldTriggerIds) return held.heldTriggerIds.includes(trigger.id) && Boolean(held.heldBotIds?.includes(trigger.botId));
  return Boolean(held.heldBotIds?.includes(trigger.botId) || (held.event?.triggerId === trigger.remote.triggerId && !held.heldBotIds));
}
