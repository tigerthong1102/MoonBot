import { setTimeout as delay } from "node:timers/promises";
import { APP_FILTER_MAX, GMAIL_APP, gmailSearchQuery, type AppTriggerFilter } from "../shared/app-triggers.ts";
import { appLabel } from "./app-event-catalog.ts";
import type { BrokerTriggerType } from "./app-trigger-broker.ts";
import { filterSchema } from "./app-trigger-file.ts";
import type { RoutineRunOn } from "./routines.ts";

export class AppTriggerError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type ConnectedApps = Record<string, { connected: boolean; accounts: Array<{ id: string; alias?: string; status: string }> }>;
export interface AppTriggerInput {
  botId: string;
  name: string;
  prompt: string;
  app: string;
  event: string;
  account?: string;
  filter?: AppTriggerFilter;
  config?: Record<string, unknown>;
  runOn?: RoutineRunOn;
  enabled?: boolean;
  sourceThreadId?: string;
  sameConversation?: boolean;
  /** Another server's automation, made here under its own id. */
  id?: string;
}

export interface AppTriggerPatch {
  name?: string;
  prompt?: string;
  runOn?: RoutineRunOn;
  filter?: AppTriggerFilter | null;
  config?: Record<string, unknown>;
  enabled?: boolean;
  sameConversation?: boolean;
  /** Undo: the config exactly as it was saved, filter already folded in. */
  restoreConfig?: Record<string, unknown>;
}

export const active = (status: string) => /^active$/i.test(status);

export function cleanFilter(filter: AppTriggerFilter | null | undefined): AppTriggerFilter | undefined {
  if (!filter) return undefined;
  const parsed = filterSchema.safeParse(filter);
  if (!parsed.success) throw new AppTriggerError(`The filter takes from, subject, label and text, each at most ${APP_FILTER_MAX} characters.`);
  const kept = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value)) as AppTriggerFilter;
  return Object.keys(kept).length ? kept : undefined;
}

/** The trigger config Composio gets: the fields the event type takes, with Gmail's plain filter as its search. */
export function triggerConfig(type: BrokerTriggerType, config: Record<string, unknown>, filter: AppTriggerFilter | undefined): Record<string, unknown> {
  const properties = (type.config.properties ?? {}) as Record<string, { default?: unknown }>;
  const known = Object.keys(properties);
  const unknown = Object.keys(config).filter((key) => known.length > 0 && !known.includes(key));
  if (unknown.length) throw new AppTriggerError(`${type.name} has no setting ${unknown.join(", ")}. Its settings are: ${known.join(", ") || "none"}.`);
  const next: Record<string, unknown> = { ...config };
  if (type.toolkit === GMAIL_APP && filter) {
    const query = [typeof next.query === "string" ? next.query.trim() : "", gmailSearchQuery(filter)].filter(Boolean).join(" ");
    if (query) next.query = query;
  }
  const required = Array.isArray(type.config.required) ? type.config.required.filter((key): key is string => typeof key === "string") : [];
  const missing = required.filter((key) => next[key] === undefined && properties[key]?.default === undefined);
  if (missing.length) throw new AppTriggerError(`${type.name} needs ${missing.join(", ")} in its settings (event_config).`);
  return next;
}

export async function resolveAccount(connectedApps: () => Promise<ConnectedApps>, app: string, wanted: string | undefined): Promise<{ id: string; alias?: string }> {
  let apps: ConnectedApps;
  try {
    apps = await connectedApps();
  } catch (error) {
    throw new AppTriggerError(`Connected apps could not be checked: ${error instanceof Error ? error.message : String(error)}`, 503);
  }
  const accounts = (apps[app]?.accounts ?? []).filter((account) => active(account.status));
  const label = appLabel(app);
  if (!accounts.length) throw new AppTriggerError(`${label} is not connected. Ask the person to connect ${label} first (COMPOSIO_MANAGE_CONNECTIONS shows them a card for it), then create the automation.`, 409);
  if (wanted?.trim()) {
    const key = wanted.trim().toLowerCase();
    const match = accounts.find((account) => account.id === wanted.trim() || account.alias?.toLowerCase() === key);
    if (!match) throw new AppTriggerError(`No connected ${label} account is called ${wanted}. The accounts are: ${accounts.map((account) => account.alias ?? account.id).join(", ")}.`);
    return match;
  }
  if (accounts.length > 1) {
    throw new AppTriggerError(`The person has ${accounts.length} ${label} accounts (${accounts.map((account) => account.alias ?? account.id).join(", ")}). Ask which one, then pass account.`);
  }
  return accounts[0]!;
}

export async function waitForAppEvents(ms: number, signal: AbortSignal): Promise<void> {
  try { await delay(ms, undefined, { signal, ref: false }); }
  catch (error) { if (!signal.aborted) throw error; }
}
