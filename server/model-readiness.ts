import type { ModelSelection } from "../shared/wire.ts";
import type { ProviderInstance } from "./contracts.ts";
import type { SideJobs } from "./side-jobs.ts";

type ModelRefusal = { code: "source_trial_key_held" | "source_org_blocked" | "source_cli_update" | "source_provider_unready"; error: string };

export function catalogModelRefusal(instance: ProviderInstance | null, model: string): ModelRefusal | null {
  const option = instance?.models.options.find(option => option.id === model && (option.orgBlocked || option.needsCliUpdate));
  if (option?.orgBlocked) return { code: "source_org_blocked", error: "This account's organization turned that model off. Propose another one." };
  if (option?.needsCliUpdate) return { code: "source_cli_update", error: `That model needs version ${option.needsCliUpdate} of its engine's CLI. Update it, or propose another model.` };
  return null;
}

const unready: ModelRefusal = { code: "source_provider_unready", error: "Select an available model for this conversation." };

export function sourceWriter(selection: ModelSelection | undefined, deps: {
  instance(id: string): ProviderInstance | null;
  held(id: string): string | undefined;
  allowed(selection: ModelSelection): boolean;
  refused(instance: ProviderInstance): string | undefined;
  write(selection: ModelSelection): ReturnType<SideJobs["sourceAnswer"]>;
}): ReturnType<SideJobs["sourceAnswer"]> | ModelRefusal {
  if (!selection) return unready;
  const held = deps.held(selection.instanceId);
  if (held) return { code: "source_trial_key_held", error: held };
  const instance = deps.instance(selection.instanceId);
  if (!instance?.enabled || deps.refused(instance) || !deps.allowed(selection)) return unready;
  return catalogModelRefusal(instance, selection.model) ?? deps.write(selection);
}
