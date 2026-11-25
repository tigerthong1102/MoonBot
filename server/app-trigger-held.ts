import { eventDigest, type HeldEvent } from "./app-trigger-file.ts";
import type { AppTrigger, AppTriggerProblem, HeldAppEventReview } from "../shared/app-triggers.ts";
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

export function summarizeHeldEvents(heldEvents: Iterable<HeldEvent>, automations: readonly AppTrigger[], visible: (trigger: AppTrigger) => boolean): HeldAppEventReview[] {
  const summaries: HeldAppEventReview[] = [];
  for (const held of heldEvents) {
    if (!held.event || held.discarded) continue;
    const triggers = automations.filter(trigger => heldEventMatches(held, trigger));
    if (triggers.some(trigger => !visible(trigger))) continue;
    summaries.push({
      key: eventDigest(held.event),
      receivedAt: held.event.receivedAt,
      reason: held.reason,
      triggers: triggers.map(trigger => ({ id: trigger.id, botId: trigger.botId, name: trigger.name })),
    });
  }
  return summaries.sort((a, b) => b.receivedAt - a.receivedAt);
}

export function activeBindingOwners(triggers: readonly AppTrigger[]): Map<string, Set<string>> {
  const active = new Map<string, Set<string>>();
  for (const trigger of triggers) {
    const remoteId = trigger.remote.triggerId;
    if (!trigger.enabled || !remoteId) continue;
    rememberBindingOwner(active, remoteId, trigger.botId);
  }
  return active;
}

export function rememberBindingOwner(owners: Map<string, Set<string>>, remoteId: string, botId: string): void {
  const bots = owners.get(remoteId) ?? new Set<string>();
  bots.add(botId);
  owners.set(remoteId, bots);
}
