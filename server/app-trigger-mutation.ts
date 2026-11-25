import type { AppTriggerFilter } from "../shared/app-triggers.ts";
import type { AppTriggerBroker, BrokerInventory } from "./app-trigger-broker.ts";
import { active, type AppTriggerPatch, type ConnectedApps } from "./app-trigger-config.ts";
import type { StoredTrigger } from "./app-trigger-file.ts";
import { isEventHoldProblem } from "./app-trigger-held.ts";

export function stageTriggerUpdate(trigger: StoredTrigger, patch: AppTriggerPatch, name: string, config: Record<string, unknown>, filter: AppTriggerFilter | undefined, now: number): StoredTrigger {
  const staged = structuredClone(trigger);
  Object.assign(staged, { name: patch.name === undefined ? staged.name : name, prompt: patch.prompt === undefined ? staged.prompt : patch.prompt.trim(),
    runOn: patch.runOn ?? staged.runOn, enabled: patch.enabled ?? staged.enabled, config, updatedAt: now });
  if (filter) staged.filter = filter; else delete staged.filter;
  if (patch.sameConversation === true) staged.sameConversation = true;
  else if (patch.sameConversation === false) delete staged.sameConversation;
  return staged;
}

export function replaceTrigger(target: StoredTrigger, value: StoredTrigger): void {
  for (const key of Object.keys(target)) delete (target as Record<string, unknown>)[key];
  Object.assign(target, value);
}

export async function reconcileTrigger(trigger: StoredTrigger, bindings: Map<string, BrokerInventory["triggers"][number]>, accounts: ConnectedApps | null,
  deps: { botState: (id: string) => string; restoreHeld: (trigger: StoredTrigger) => void; bind: (trigger: StoredTrigger) => Promise<void>;
    assertCredential: () => void; broker: AppTriggerBroker; now: () => number }): Promise<void> {
  if (trigger.enabled && deps.botState(trigger.botId) === "missing") trigger.enabled = false;
  const account = accounts?.[trigger.app]?.accounts.find(candidate => candidate.id === trigger.accountId);
  if (accounts && (!account || !active(account.status))) {
    if (trigger.problem?.kind !== "reconnect") trigger.problem = { kind: "reconnect", at: deps.now() };
    return;
  }
  if (account && trigger.problem?.kind === "reconnect") deps.restoreHeld(trigger);
  const binding = trigger.remote.triggerId ? bindings.get(trigger.remote.triggerId) : undefined;
  if (!binding || binding.remote?.state === "missing") {
    trigger.remote = { state: "pending" };
    await deps.bind(trigger);
    deps.assertCredential();
    if (!trigger.enabled && trigger.remote.triggerId) await deps.broker.setEnabled(trigger.remote.triggerId, false);
    return;
  }
  trigger.remote = { triggerId: binding.triggerId, state: "active", syncedAt: deps.now() };
  if (trigger.problem?.kind === "error" && !isEventHoldProblem(trigger.problem)) delete trigger.problem;
}

export async function syncReplacementBinding(triggerId: string | undefined, previous: StoredTrigger, next: StoredTrigger, triggers: readonly StoredTrigger[],
  outOfReach: () => boolean, broker: AppTriggerBroker, pending: () => void): Promise<void> {
  if (!triggerId) return;
  const bindings = triggers.filter(trigger => trigger !== previous && trigger.remote.triggerId === triggerId);
  if (next.remote.triggerId === triggerId) bindings.push(next);
  if (!bindings.length) {
    if (outOfReach()) pending(); else await broker.remove(triggerId);
  } else if (!outOfReach()) await broker.setEnabled(triggerId, bindings.some(trigger => trigger.enabled));
}
