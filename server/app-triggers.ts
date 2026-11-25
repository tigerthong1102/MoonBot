// App-event automations: the store (DATA_DIR/app-triggers.json), their copies on the connected-apps service kept in
// step without the person (reconciliation), and the long-poll that turns each queued event into a routine run. One
// path on desktop, headless and Cloud: Composio posts to the service, this server collects from it.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import {
  APP_FILTER_MAX,
  GMAIL_APP,
  gmailSearchQuery,
  type AppEventAttempt,
  type AppEventOutcome,
  type AppTrigger,
  type AppTriggerFilter,
  type AppTriggerService,
  type AppTriggersSnapshot,
} from "../shared/app-triggers.ts";
import { appLabel } from "./app-event-catalog.ts";
import { eventBlock, eventPreview, eventPrompt, matchesFilter, mergeEventBlock } from "./app-events.ts";
import { brokerEventSchema, BrokerError, type AppTriggerBroker, type BrokerEvent, type BrokerInventory, type BrokerTriggerType } from "./app-trigger-broker.ts";
import { writeFileAtomic } from "./atomic.ts";
import { instructionsUpdateRefusal } from "./automation-instructions.ts";
import { DATA_DIR } from "./config.ts";
import type { RoutineRunOn } from "./routines.ts";

export const DEFAULT_MAX_PENDING_RUNS = 3;
const MAX_ATTEMPTS = 2_000;
const MAX_DELETED = 50;
const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60_000;
const POLL_WAIT_S = 25;
const IDLE_CHECK_MS = 30_000;
const POISON_TRIES = 5;
/** Reconciliation also reads the service's per-trigger drop counts, so it runs more often while events can arrive. */
const RECONCILE_ACTIVE_MS = 15 * 60_000;
const RECONCILE_IDLE_MS = 60 * 60_000;
const NAME_MAX = 80;
const PROMPT_MAX = 20_000;
const MAX_HELD_EVENTS = 100;
const MAX_HELD_BYTES = 2_000_000;
const LINKED_EVENT_CONFLICT = "Linked bots have overlapping app automations. Review them before this event can run.";
const EVENT_HISTORY_UNAVAILABLE = "Event history or bot links cannot be checked. Restore access and review the automation before continuing.";
const isEventHoldProblem = (problem: StoredTrigger["problem"]) => problem?.kind === "error" && (problem.text === LINKED_EVENT_CONFLICT || problem.text === EVENT_HISTORY_UNAVAILABLE);

class LinkedEventConflict extends Error {}
class RetryAppEvent extends Error {}

export class AppTriggerError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type ConnectedApps = Record<string, { connected: boolean; accounts: Array<{ id: string; alias?: string; status: string }> }>;
type Frame = { kind: "app-trigger"; botId: string; trigger: AppTrigger } | { kind: "app-trigger.deleted"; triggerId: string }
  | { kind: "app-trigger.attempt"; botId: string; attempt: AppEventAttempt } | { kind: "app-trigger.service"; service: AppTriggerService };

export interface AppTriggerManagerOptions {
  file?: string;
  now?: () => number;
  broker: AppTriggerBroker;
  /** Whether app events can work here at all, and why not. Checked on every loop, since access arrives late. */
  service: () => { available: true } | { available: false; reason: "self-hosted" | "unavailable" | "off" };
  connectedApps: () => Promise<ConnectedApps>;
  botState: (botId: string) => "ready" | "busy" | "missing";
  linkedBots?: (first: string, second: string) => boolean;
  runs: {
    enqueue(input: { webhookId: string; webhookName: string; prompt: string; botId: string; runOn: RoutineRunOn; deliveryId: string; receivedAt: number; eventSource: "app"; sameConversation?: boolean }): { id: string };
    merge(triggerId: string, eventId: string, sameConversation: boolean, merge: (prompt: string) => string | null): { id: string } | null;
    receipt(triggerId: string, eventId: string): { id: string } | null;
    eventRecipients?(eventId: string): Array<string | null>;
    pending(triggerId: string): number;
    cancelQueued(triggerId: string, message: string): void;
  };
  emit?: (frame: Frame) => void;
  log?: (line: string) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const filterSchema = z.object({
  from: z.string().trim().max(APP_FILTER_MAX).optional(),
  subject: z.string().trim().max(APP_FILTER_MAX).optional(),
  label: z.string().trim().max(APP_FILTER_MAX).optional(),
  text: z.string().trim().max(APP_FILTER_MAX).optional(),
}).strict();
const skippedSchema = z.object({ day: z.string(), dailyLimit: z.number(), queueFull: z.number(), expired: z.number(), tooMany: z.number() });
const dropCounts = z.record(z.string(), z.number());
const storedSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  prompt: z.string(),
  botId: z.string().min(1),
  runOn: z.enum(["maus", "cloud"]),
  enabled: z.boolean(),
  app: z.string().min(1),
  appName: z.string(),
  event: z.string().min(1),
  eventName: z.string(),
  delivery: z.enum(["instant", "poll"]),
  accountId: z.string().min(1),
  accountLabel: z.string().optional(),
  config: z.record(z.string(), z.unknown()),
  filter: filterSchema.optional().catch(undefined),
  remote: z.object({ triggerId: z.string().optional(), state: z.enum(["active", "pending", "error"]), error: z.string().optional(), syncedAt: z.number().optional() }),
  problem: z.union([
    z.object({ kind: z.literal("reconnect"), at: z.number() }),
    z.object({ kind: z.literal("error"), text: z.string(), at: z.number() }),
  ]).optional().catch(undefined),
  sourceThreadId: z.string().optional(),
  sameConversation: z.boolean().optional().catch(undefined),
  received: z.number().int().nonnegative(),
  filtered: z.number().int().nonnegative(),
  skipped: skippedSchema.optional().catch(undefined),
  lastEventAt: z.number().optional(),
  lastRunId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** The service's cumulative drop counts as last seen, and as they stood when this UTC day began. */
  drops: z.object({ day: z.string(), base: dropCounts, last: dropCounts }).optional().catch(undefined),
});
type StoredTrigger = z.output<typeof storedSchema>;
const attemptSchema = z.object({
  id: z.string(),
  triggerId: z.string(),
  eventId: z.string(),
  at: z.number(),
  outcome: z.enum(["started", "joined", "filtered", "duplicate", "skipped", "rejected"]),
  reason: z.string().optional(),
  runId: z.string().optional(),
  preview: z.string().optional(),
});
const fileSchema = z.object({
  version: z.literal(1),
  pollerId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  cursor: z.number().int().nonnegative(),
  triggers: z.array(storedSchema),
  attempts: z.array(attemptSchema).default([]),
  deleted: z.array(z.object({ at: z.number(), trigger: storedSchema })).default([]),
  heldEvents: z.array(z.union([z.string(), z.object({ id: z.string(), reason: z.enum(["conflict", "unknown"]), event: brokerEventSchema.optional() })])).default([]),
  bindingOwners: z.array(z.object({ remoteId: z.string(), botId: z.string() })).default([]),
});
const heldStoreSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), events: z.array(z.object({ id: z.string(), reason: z.enum(["conflict", "unknown"]), event: brokerEventSchema.optional(), allowedTriggerIds: z.array(z.string()).optional(), heldBotIds: z.array(z.string()).optional() })) });

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

const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
const active = (status: string) => /^active$/i.test(status);

function cleanFilter(filter: AppTriggerFilter | null | undefined): AppTriggerFilter | undefined {
  if (!filter) return undefined;
  const parsed = filterSchema.safeParse(filter);
  if (!parsed.success) throw new AppTriggerError(`The filter takes from, subject, label and text, each at most ${APP_FILTER_MAX} characters.`);
  const kept = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value)) as AppTriggerFilter;
  return Object.keys(kept).length ? kept : undefined;
}

/** The trigger config Composio gets: the fields the event type takes, with Gmail's plain filter as its search. */
function triggerConfig(type: BrokerTriggerType, config: Record<string, unknown>, filter: AppTriggerFilter | undefined): Record<string, unknown> {
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

function publicTrigger(stored: StoredTrigger): AppTrigger {
  const { drops: _drops, ...trigger } = stored;
  return structuredClone(trigger);
}

export class AppTriggerManager {
  private readonly file: string;
  private readonly heldFile: string;
  private readonly now: () => number;
  private readonly options: AppTriggerManagerOptions;
  private triggers: StoredTrigger[] = [];
  private attemptLog: AppEventAttempt[] = [];
  private deleted: Array<{ at: number; trigger: StoredTrigger }> = [];
  private pollerId = randomBytes(16).toString("base64url");
  private cursor = 0;
  private unreadable = false;
  private mutationsInFlight = 0;
  private usage: { plan: "desktop" | "cloud"; eventsPerDay: number; eventsToday: number } | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private failures = new Map<string, number>();
  private heldEvents = new Map<string, { reason: "conflict" | "unknown"; event?: BrokerEvent; allowedTriggerIds?: string[]; heldBotIds?: string[] }>();
  private heldUnreadable = false;
  private bindingOwners = new Map<string, Set<string>>();
  private stopped = true;
  private abort = new AbortController();
  private nextReconcileAt = 0;
  private loop: Promise<void> | null = null;
  private runVersion = 0;
  /** A deleted automation's service copy could not be removed yet; reconciliation removes it. */
  private releasePending = false;

  constructor(options: AppTriggerManagerOptions) {
    this.options = options;
    this.file = options.file ?? join(DATA_DIR, "app-triggers.json");
    this.heldFile = `${this.file}.held`;
    this.now = options.now ?? Date.now;
    let embeddedEvents = false;
    let upgradeHeldStore = false;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.file, "utf8")));
      if (!parsed.success) throw parsed.error;
      this.pollerId = parsed.data.pollerId;
      this.cursor = parsed.data.cursor;
      this.triggers = parsed.data.triggers;
      this.attemptLog = parsed.data.attempts.slice(-MAX_ATTEMPTS);
      this.deleted = parsed.data.deleted.filter((entry) => entry.at >= this.now() - RESTORE_WINDOW_MS);
      this.heldEvents = new Map(parsed.data.heldEvents.map(row => typeof row === "string" ? [row, { reason: "conflict" as const }] : [row.id, { reason: row.reason, ...(row.event ? { event: row.event } : {}) }]));
      embeddedEvents = parsed.data.heldEvents.some(row => typeof row !== "string" && row.event !== undefined);
      for (const owner of parsed.data.bindingOwners) this.rememberBindingOwner(owner.remoteId, owner.botId);
      for (const trigger of [...parsed.data.triggers, ...parsed.data.deleted.map(entry => entry.trigger)]) {
        if (trigger.remote.triggerId) this.rememberBindingOwner(trigger.remote.triggerId, trigger.botId);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.unreadable = true;
        console.error(`app triggers: ignoring unreadable ${this.file}: ${error instanceof SyntaxError ? "invalid JSON" : error instanceof Error ? error.message : "unreadable"}`);
      }
    }
    try {
      const stored = heldStoreSchema.parse(JSON.parse(readFileSync(this.heldFile, "utf8")));
      upgradeHeldStore = stored.version === 1;
      if (new Set(stored.events.map(row => row.id)).size !== stored.events.length) throw new Error("Duplicate held event IDs");
      for (const row of stored.events) {
        if (row.event && row.event.id !== row.id) throw new Error("Mismatched held event ID");
        const existing = this.heldEvents.get(row.id);
        if (existing?.event && row.event && JSON.stringify(existing.event) !== JSON.stringify(row.event)) throw new Error("Conflicting held event copies");
        const event = row.event ?? existing?.event;
        this.heldEvents.set(row.id, { reason: row.reason, ...(event ? { event } : {}), ...(row.allowedTriggerIds ? { allowedTriggerIds: row.allowedTriggerIds } : {}), ...(row.heldBotIds ? { heldBotIds: row.heldBotIds } : {}) });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.heldUnreadable = true;
    }
    if ([...this.heldEvents.values()].some(value => !value.event)) this.heldUnreadable = true;
    if (!this.heldUnreadable) for (const held of this.heldEvents.values()) {
      const reason = held.reason === "conflict" ? LINKED_EVENT_CONFLICT : EVENT_HISTORY_UNAVAILABLE;
      for (const trigger of this.bound(held.event?.triggerId ?? null)) if (held.heldBotIds?.includes(trigger.botId)) trigger.problem = { kind: "error", text: reason, at: this.now() };
    }
    if ((embeddedEvents || upgradeHeldStore) && !this.heldUnreadable) {
      try {
        mkdirSync(dirname(this.heldFile), { recursive: true });
        writeFileAtomic(this.heldFile, JSON.stringify({ version: 2, events: [...this.heldEvents].map(([id, value]) => ({ id, ...value })) }), { mode: 0o600 });
      } catch { this.heldUnreadable = true; }
    }
  }

  list(): AppTrigger[] {
    return this.triggers.map(publicTrigger);
  }

  mutationActivity(): "unreadable" | "changing" | "no-mutation" {
    return this.unreadable ? "unreadable" : this.mutationsInFlight > 0 ? "changing" : "no-mutation";
  }

  private async trackMutation<T>(work: () => Promise<T>): Promise<T> {
    this.mutationsInFlight++;
    try { return await work(); }
    finally { this.mutationsInFlight--; }
  }

  get(id: string): AppTrigger | null {
    const stored = this.triggers.find((trigger) => trigger.id === id);
    return stored ? publicTrigger(stored) : null;
  }

  attempts(): AppEventAttempt[] {
    return this.attemptLog.map((attempt) => ({ ...attempt }));
  }

  service(): AppTriggerService {
    const service = this.options.service();
    if (!service.available) return { available: false, reason: service.reason };
    return { available: true, ...this.usage };
  }

  snapshot(): AppTriggersSnapshot {
    return { triggers: this.list(), attempts: this.attempts(), service: this.service() };
  }

  /** Validated against the event type and the person's connected accounts, then saved and copied to the service. A
   *  service that cannot be reached leaves it pending; reconciliation finishes it. */
  async create(input: AppTriggerInput): Promise<AppTrigger> {
    return this.trackMutation(() => this.createTracked(input));
  }

  private async createTracked(input: AppTriggerInput): Promise<AppTrigger> {
    this.assertWritable();
    this.assertAvailable();
    const name = input.name.trim().slice(0, NAME_MAX);
    const prompt = input.prompt.trim();
    if (!name) throw new AppTriggerError("An automation needs a name.");
    if (prompt.length > PROMPT_MAX) throw new AppTriggerError(`Instructions can be at most ${PROMPT_MAX} characters.`);
    if (this.options.botState(input.botId) === "missing") throw new AppTriggerError("That bot no longer exists.", 404);
    const app = input.app.trim().toLowerCase();
    const type = await this.remote(() => this.options.broker.triggerType(input.event.trim()));
    if (!type) throw new AppTriggerError(`${input.event} is not an event StartupBot can watch. Call trigger_info action=events to see the events this app offers.`, 404);
    if (type.toolkit !== app) throw new AppTriggerError(`${type.slug} is a ${appLabel(type.toolkit)} event, not ${appLabel(app)}.`);
    const account = await this.resolveAccount(app, input.account);
    const filter = cleanFilter(input.filter);
    const config = triggerConfig(type, input.config ?? {}, filter);
    const now = this.now();
    const trigger: StoredTrigger = {
      id: input.id ?? randomUUID(), name, prompt, botId: input.botId, runOn: input.runOn ?? "maus", enabled: input.enabled ?? true,
      app, appName: appLabel(app), event: type.slug, eventName: type.name || type.slug, delivery: type.type === "poll" ? "poll" : "instant",
      accountId: account.id, ...(account.alias ? { accountLabel: account.alias } : {}), config, ...(filter ? { filter } : {}),
      remote: { state: "pending" }, ...(input.sourceThreadId ? { sourceThreadId: input.sourceThreadId } : {}),
      ...(input.sameConversation ? { sameConversation: true } : {}),
      received: 0, filtered: 0, createdAt: now, updatedAt: now,
    };
    await this.exclusive(async () => {
      if (this.triggers.some((candidate) => candidate.id === trigger.id)) throw new AppTriggerError("An automation with this id already exists.", 409);
      const duplicate = this.triggers.find((trigger) => trigger.enabled && trigger.botId === input.botId && trigger.event === type.slug &&
        trigger.accountId === account.id && trigger.prompt === prompt && JSON.stringify(trigger.config) === JSON.stringify(config));
      if (duplicate) throw new AppTriggerError(`The same automation already exists (${duplicate.id}). Use trigger_info to review it, then change that one instead.`, 409);
      try {
        await this.bind(trigger);
        await this.applyEnabled(trigger.remote.triggerId, trigger.enabled);
      } catch (error) {
        // Composio refused this config: nothing to save. Anything else is retried by reconciliation.
        if (error instanceof BrokerError && !error.transient && error.status !== 403) throw new AppTriggerError(error.message, 400);
        this.markRemoteFailure(trigger, error);
      }
      this.triggers.unshift(trigger);
      this.save();
    });
    this.emitTrigger(trigger);
    this.wake();
    return publicTrigger(trigger);
  }

  /** Another server's automation under its own id, against the same connected account: a new one starts switched off;
   * one already here keeps its switch and takes the rest. */
  async adopt(record: AppTrigger): Promise<AppTrigger> {
    return this.trackMutation(() => this.adoptTracked(record));
  }

  private async adoptTracked(record: AppTrigger): Promise<AppTrigger> {
    const config = Object.fromEntries(Object.entries(record.config).filter(([key, value]) => value !== undefined && !(record.app === GMAIL_APP && key === "query")));
    if (this.triggers.some((candidate) => candidate.id === record.id)) {
      return (await this.update(record.id, { name: record.name, prompt: record.prompt, runOn: record.runOn, filter: record.filter ?? null, config,
        sameConversation: record.sameConversation === true }))!;
    }
    try {
      return await this.create({ id: record.id, botId: record.botId, name: record.name, prompt: record.prompt, app: record.app, event: record.event, account: record.accountId,
        ...(record.filter ? { filter: record.filter } : {}), config, runOn: record.runOn, enabled: false, ...(record.sourceThreadId ? { sourceThreadId: record.sourceThreadId } : {}),
        ...(record.sameConversation ? { sameConversation: true } : {}) });
    } catch (error) {
      if (error instanceof AppTriggerError && error.status === 409 && this.triggers.some((candidate) => candidate.id === record.id)) {
        return (await this.update(record.id, { name: record.name, prompt: record.prompt, runOn: record.runOn, filter: record.filter ?? null, config,
          sameConversation: record.sameConversation === true }))!;
      }
      throw error;
    }
  }

  async update(id: string, patch: AppTriggerPatch, options: { protectInstructions?: boolean } = {}): Promise<AppTrigger | null> {
    return this.trackMutation(() => this.updateTracked(id, patch, options));
  }

  private async updateTracked(id: string, patch: AppTriggerPatch, options: { protectInstructions?: boolean }): Promise<AppTrigger | null> {
    this.assertWritable();
    const trigger = this.triggers.find((candidate) => candidate.id === id);
    if (!trigger) return null;
    const name = patch.name === undefined ? trigger.name : patch.name.trim().slice(0, NAME_MAX);
    if (!name) throw new AppTriggerError("An automation needs a name.");
    if (patch.prompt !== undefined && patch.prompt.trim().length > PROMPT_MAX) throw new AppTriggerError(`Instructions can be at most ${PROMPT_MAX} characters.`);
    const filter = patch.filter === undefined ? trigger.filter : cleanFilter(patch.filter);
    const reconfigure = patch.filter !== undefined || patch.config !== undefined || patch.restoreConfig !== undefined;
    let config = patch.restoreConfig ?? trigger.config;
    if (reconfigure && !patch.restoreConfig) {
      this.assertAvailable();
      const type = await this.remote(() => this.options.broker.triggerType(trigger.event));
      if (!type) throw new AppTriggerError(`${trigger.eventName} can no longer be watched; delete this automation.`, 410);
      const base = patch.config ?? (trigger.app === GMAIL_APP ? { ...trigger.config, query: undefined } : trigger.config);
      config = triggerConfig(type, Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined)), filter);
    }
    await this.exclusive(async () => {
      if (options.protectInstructions) {
        const refusal = instructionsUpdateRefusal(trigger.prompt, patch.prompt);
        if (refusal) throw new AppTriggerError(refusal, 409);
      }
      const previous = trigger.remote.triggerId;
      const previousConfig = JSON.stringify(trigger.config);
      Object.assign(trigger, {
        name,
        prompt: patch.prompt === undefined ? trigger.prompt : patch.prompt.trim(),
        runOn: patch.runOn ?? trigger.runOn,
        enabled: patch.enabled ?? trigger.enabled,
        config,
        updatedAt: this.now(),
      });
      if (filter) trigger.filter = filter;
      else delete trigger.filter;
      if (patch.sameConversation === true) trigger.sameConversation = true;
      else if (patch.sameConversation === false) delete trigger.sameConversation;
      if (patch.enabled === false) this.options.runs.cancelQueued(trigger.id, "The automation was paused before this event's run started");
      try {
        if (reconfigure && (!previous || JSON.stringify(config) !== previousConfig)) {
          trigger.remote = { state: "pending" };
          await this.bind(trigger);
          await this.release(previous);
        }
        await this.applyEnabled(trigger.remote.triggerId);
      } catch (error) {
        this.markRemoteFailure(trigger, error);
      }
      this.save();
    });
    this.emitTrigger(trigger);
    this.wake();
    return publicTrigger(trigger);
  }

  async remove(id: string): Promise<boolean> {
    return this.trackMutation(() => this.removeTracked(id));
  }

  private async removeTracked(id: string): Promise<boolean> {
    this.assertWritable();
    const trigger = this.triggers.find((candidate) => candidate.id === id);
    if (!trigger) return false;
    await this.exclusive(async () => {
      this.triggers = this.triggers.filter((candidate) => candidate !== trigger);
      this.deleted = [...this.deleted.filter((entry) => entry.at >= this.now() - RESTORE_WINDOW_MS && entry.trigger.id !== id),
        { at: this.now(), trigger: structuredClone(trigger) }].slice(-MAX_DELETED);
      this.options.runs.cancelQueued(id, "The automation was deleted before this event's run started");
      this.save();
      try {
        await this.release(trigger.remote.triggerId);
      } catch (error) {
        this.log(`could not remove ${trigger.remote.triggerId ?? id} from the connected-apps service yet: ${String(error)}`);
        this.releasePending = true;
        this.nextReconcileAt = this.now();
      }
    });
    this.options.emit?.({ kind: "app-trigger.deleted", triggerId: id });
    return true;
  }

  /** Brings back one deleted in the last week, with its settings; the service copy is made again. */
  async restore(id: string): Promise<AppTrigger | null> {
    return this.trackMutation(() => this.restoreTracked(id));
  }

  private async restoreTracked(id: string): Promise<AppTrigger | null> {
    this.assertWritable();
    return this.exclusive(async () => {
      const entry = this.deleted.find((candidate) => candidate.trigger.id === id && candidate.at >= this.now() - RESTORE_WINDOW_MS);
      if (!entry || this.triggers.some((trigger) => trigger.id === id)) return null;
      if (this.options.botState(entry.trigger.botId) === "missing") throw new AppTriggerError("The assigned bot no longer exists.", 410);
      const trigger: StoredTrigger = { ...structuredClone(entry.trigger), remote: { state: "pending" }, updatedAt: this.now() };
      try { await this.bind(trigger); await this.applyEnabled(trigger.remote.triggerId, trigger.enabled); }
      catch (error) { this.markRemoteFailure(trigger, error); }
      this.deleted = this.deleted.filter((candidate) => candidate !== entry);
      this.triggers.unshift(trigger);
      this.save();
      this.emitTrigger(trigger);
      this.wake();
      return publicTrigger(trigger);
    });
  }

  /** A test event marked as one, sent through the service's real queue when the automation has its copy there. */
  async runNow(id: string): Promise<{ via: "service" | "here"; runId?: string } | null> {
    return this.trackMutation(() => this.runNowTracked(id));
  }

  private async runNowTracked(id: string): Promise<{ via: "service" | "here"; runId?: string } | null> {
    this.assertWritable();
    const trigger = this.triggers.find((candidate) => candidate.id === id);
    if (!trigger) return null;
    if (trigger.remote.triggerId && this.bound(trigger.remote.triggerId).length > 1) throw new AppTriggerError("This test cannot target one automation because its event source is shared. Review the automations first.", 409);
    const data = { omb_test: true, note: "A test run started from StartupBot." };
    if (trigger.remote.triggerId && trigger.remote.state === "active" && this.options.service().available) {
      try {
        await this.options.broker.testEvent(trigger.remote.triggerId, data);
        this.wake();
        return { via: "service" };
      } catch (error) {
        if (!(error instanceof BrokerError) || !error.transient) throw new AppTriggerError(error instanceof Error ? error.message : String(error), 502);
      }
    }
    const eventId = `test_${randomUUID()}`;
    const run = this.options.runs.enqueue({
      webhookId: trigger.id, webhookName: trigger.name, botId: trigger.botId, runOn: trigger.runOn, deliveryId: eventId, receivedAt: this.now(),
      eventSource: "app", sameConversation: trigger.sameConversation, prompt: eventPrompt(trigger.prompt, eventBlock(trigger, { id: eventId, receivedAt: this.now(), test: true, data })),
    });
    return { via: "here", runId: run.id };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.abort = new AbortController();
    this.nextReconcileAt = 0;
    this.loop = this.run(++this.runVersion).catch((error) => this.log(`app events stopped: ${error instanceof Error ? error.message : String(error)}`));
  }

  async stop(): Promise<void> {
    const loop = this.loop;
    this.stopped = true;
    this.runVersion += 1;
    this.abort.abort();
    await loop;
    if (this.loop === loop) this.loop = null;
  }

  /** Cuts the current wait short: a trigger changed, or access to the service arrived. */
  wake(): void {
    const previous = this.abort;
    this.abort = new AbortController();
    previous.abort();
  }

  /** Compares every automation with the service's copy and fixes what differs: a missing copy is made, one nobody
   *  wants is deleted, and on/off is matched. Idempotent; the person is never asked to set anything up again. */
  reconcile(): Promise<void> {
    return this.trackMutation(() => {
      this.assertWritable();
      return this.exclusive(() => { this.assertWritable(); return this.reconcileNow(); });
    });
  }

  /** Handles one batch in order. The cursor (the service's ack) moves only after the runs and this file are saved:
   *  a crash before that brings the same events back, and each event's run receipt stops a second run. */
  receive(events: BrokerEvent[], cursor: number): void {
    this.assertWritable();
    if (this.heldUnreadable) throw new RetryAppEvent("Held event storage is unavailable");
    let next = this.cursor;
    try {
      for (const event of events) {
        try {
          this.handle(event);
        } catch (error) {
          if (error instanceof RetryAppEvent) throw error;
          if (error instanceof LinkedEventConflict) {
            this.holdEvent(event, error.message === LINKED_EVENT_CONFLICT ? "conflict" : "unknown");
            next = event.seq;
            continue;
          }
          if (this.heldEvents.has(event.id)) throw new RetryAppEvent("Held event delivery failed; retry is required");
          const tries = (this.failures.get(event.id) ?? 0) + 1;
          this.failures.set(event.id, tries);
          if (tries < POISON_TRIES) throw error;
          this.failures.delete(event.id);
          for (const trigger of this.bound(event.triggerId)) {
            this.record(trigger, event, "rejected", { reason: `Could not be handled: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) });
          }
        }
        next = event.seq;
      }
      next = Math.max(next, cursor);
    } finally {
      this.save({ cursor: next });
      this.cursor = next;
    }
  }

  private handle(event: BrokerEvent): void {
    if (event.kind === "account_expired") {
      const accountId = event.event.data?.connected_account_id;
      for (const trigger of this.triggers.filter((candidate) => candidate.accountId === accountId)) this.setProblem(trigger, { kind: "reconnect", at: this.now() });
      return;
    }
    if (event.kind === "trigger_disabled") {
      for (const trigger of this.bound(event.triggerId)) this.setProblem(trigger, { kind: "reconnect", at: this.now() });
      return;
    }
    const data = event.event.data ?? {};
    const held = this.heldEvents.get(event.id);
    if (held?.event && JSON.stringify(held.event) !== JSON.stringify(event)) throw new RetryAppEvent("Conflicting event identity");
    if (this.mutationsInFlight) throw new RetryAppEvent(EVENT_HISTORY_UNAVAILABLE);
    const allBound = this.bound(event.triggerId);
    const bound = held ? allBound.filter(trigger => held.allowedTriggerIds?.includes(trigger.id)) : allBound;
    if (held && !this.options.linkedBots) throw new RetryAppEvent(EVENT_HISTORY_UNAVAILABLE);
    if (held && (!held.allowedTriggerIds || !held.heldBotIds)) return;
    const candidates = bound.filter(trigger => this.options.runs.receipt(trigger.id, event.id) || (trigger.enabled && this.options.botState(trigger.botId) !== "missing" && matchesFilter(trigger.app, trigger.filter, data)));
    if (this.options.linkedBots) {
      const affected = new Set<StoredTrigger>();
      let reason = LINKED_EVENT_CONFLICT;
      try {
        if (!this.options.runs.eventRecipients) throw new Error("Event receipt lookup unavailable");
        const previous = this.options.runs.eventRecipients(event.id);
        for (const candidate of candidates) if (held?.heldBotIds?.some(bot => bot === candidate.botId || this.options.linkedBots!(bot, candidate.botId))) affected.add(candidate);
        const owners = event.triggerId ? [...(this.bindingOwners.get(event.triggerId) ?? [])] : [];
        bound.forEach((first, index) => bound.slice(index + 1).forEach(second => {
          if (first.botId !== second.botId && this.options.linkedBots!(first.botId, second.botId)) { affected.add(first); affected.add(second); }
        }));
        for (const candidate of candidates) {
          if (previous.some(bot => bot === null || (bot !== candidate.botId && this.options.linkedBots!(bot, candidate.botId))) || owners.some(bot => bot !== candidate.botId && this.options.linkedBots!(bot, candidate.botId))) affected.add(candidate);
        }
      } catch {
        if (held) throw new RetryAppEvent(EVENT_HISTORY_UNAVAILABLE);
        reason = EVENT_HISTORY_UNAVAILABLE;
        for (const trigger of candidates.length ? candidates : bound) affected.add(trigger);
        if (!affected.size) throw new LinkedEventConflict(reason);
      }
      if (affected.size) {
        const allowedTriggerIds = candidates.filter(trigger => !affected.has(trigger)).map(trigger => trigger.id);
        this.holdEvent(event, reason === LINKED_EVENT_CONFLICT ? "conflict" : "unknown", allowedTriggerIds, [...affected].map(trigger => trigger.botId));
        const changed = [...affected].filter(trigger => trigger.problem?.kind !== "error" || trigger.problem.text !== reason);
        for (const trigger of changed) trigger.problem = { kind: "error", text: reason, at: this.now() };
        for (const trigger of changed) this.emitTrigger(trigger);
        for (let index = bound.length - 1; index >= 0; index--) if (!allowedTriggerIds.includes(bound[index]!.id)) bound.splice(index, 1);
      }
    }
    for (const trigger of bound) {
      if (isEventHoldProblem(trigger.problem)) {
        delete trigger.problem;
        this.emitTrigger(trigger);
      }
    }
    for (const trigger of bound) {
      if (!trigger.enabled) {
        this.record(trigger, event, "skipped", { reason: "paused" });
        continue;
      }
      if (this.options.botState(trigger.botId) === "missing") {
        this.record(trigger, event, "rejected", { reason: "its bot was deleted" });
        continue;
      }
      if (!matchesFilter(trigger.app, trigger.filter, data)) {
        trigger.filtered += 1;
        this.record(trigger, event, "filtered", { reason: "did not match the filter" });
        continue;
      }
      const seen = this.options.runs.receipt(trigger.id, event.id);
      if (seen) {
        this.record(trigger, event, "duplicate", { runId: seen.id });
        continue;
      }
      const block = eventBlock(trigger, { id: event.id, receivedAt: event.receivedAt, test: event.kind === "test", data });
      const joined = this.options.runs.merge(trigger.id, event.id, trigger.sameConversation === true, (prompt) => mergeEventBlock(prompt, block));
      let runId = joined?.id;
      if (!runId) {
        if (this.options.runs.pending(trigger.id) >= DEFAULT_MAX_PENDING_RUNS) {
          this.countSkipped(trigger, "tooMany");
          this.record(trigger, event, "skipped", { reason: `it already had ${DEFAULT_MAX_PENDING_RUNS} runs waiting` });
          continue;
        }
        runId = this.options.runs.enqueue({
          webhookId: trigger.id, webhookName: trigger.name, prompt: eventPrompt(trigger.prompt, block), botId: trigger.botId,
          runOn: trigger.runOn, deliveryId: event.id, receivedAt: event.receivedAt, eventSource: "app",
          sameConversation: trigger.sameConversation,
        }).id;
      }
      trigger.received += 1;
      trigger.lastEventAt = event.receivedAt;
      trigger.lastRunId = runId;
      if (trigger.problem?.kind === "reconnect" && event.kind === "message") delete trigger.problem;
      this.record(trigger, event, joined ? "joined" : "started", { runId });
    }
  }

  private async run(version: number): Promise<void> {
    let failures = 0;
    while (!this.stopped && version === this.runVersion) {
      const signal = this.abort.signal;
      try {
        if (this.options.service().available && this.now() >= this.nextReconcileAt && (this.triggers.length > 0 || this.releasePending)) {
          this.nextReconcileAt = this.now() + (this.pollable() ? RECONCILE_ACTIVE_MS : RECONCILE_IDLE_MS);
          await this.reconcile().catch((error) => {
            this.nextReconcileAt = this.now() + Math.min(RECONCILE_ACTIVE_MS, 30_000 * 2 ** Math.min(failures, 5));
            this.log(`reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        if (this.stopped || version !== this.runVersion) break;
        if (!this.pollable()) {
          await this.sleep(IDLE_CHECK_MS, signal);
          continue;
        }
        await this.pollOnce(signal);
        failures = 0;
      } catch (error) {
        if (this.stopped || version !== this.runVersion) break;
        if (signal.aborted) continue;
        failures += 1;
        const retry = error instanceof BrokerError && (error.status === 409 || error.transient) && error.retryAfterS ? error.retryAfterS * 1000 : 0;
        await this.sleep(retry || Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6)), this.abort.signal);
      }
    }
  }

  /** One long-poll: acks everything handled so far (the cursor) and handles what comes back. */
  async pollOnce(signal?: AbortSignal, waitS = POLL_WAIT_S): Promise<number> {
    this.assertWritable();
    const { events, cursor } = await this.options.broker.poll({ after: this.cursor, waitS, poller: this.pollerId, signal });
    if (signal?.aborted) return 0;
    if (events.length || cursor > this.cursor) this.receive(events, cursor);
    return events.length;
  }

  private pollable(): boolean {
    return this.options.service().available && this.triggers.some((trigger) => trigger.enabled && trigger.remote.triggerId);
  }

  private async reconcileNow(): Promise<void> {
    if (!this.options.service().available) return;
    const inventory = await this.options.broker.inventory();
    this.usage = { plan: inventory.limits.plan, eventsPerDay: inventory.limits.eventsPerDay, eventsToday: inventory.usage.eventsToday };
    const accounts = await this.options.connectedApps().catch(() => null);
    const bindings = new Map(inventory.triggers.map((binding) => [binding.triggerId, binding]));
    const changed = new Set<StoredTrigger>();
    for (const trigger of this.triggers) {
      const before = JSON.stringify(trigger);
      try {
        await this.reconcileOne(trigger, bindings, accounts);
      } catch (error) {
        this.markRemoteFailure(trigger, error);
      }
      this.noteDrops(trigger, trigger.remote.triggerId ? bindings.get(trigger.remote.triggerId)?.dropped : undefined);
      if (JSON.stringify(trigger) !== before) changed.add(trigger);
    }
    const wanted = new Set(this.triggers.map((trigger) => trigger.remote.triggerId).filter((id): id is string => Boolean(id)));
    for (const triggerId of wanted) {
      const binding = bindings.get(triggerId);
      const desired = this.wantsEnabled(triggerId);
      if (binding && (binding.enabled !== desired || (desired && binding.remote?.state === "disabled"))) {
        await this.options.broker.setEnabled(triggerId, desired).catch((error) => this.log(`could not switch ${triggerId}: ${String(error)}`));
      }
    }
    const orphans = [...inventory.triggers.map((binding) => binding.triggerId), ...(inventory.unbound ?? []).map((instance) => instance.triggerId)]
      .filter((triggerId) => !wanted.has(triggerId));
    let removed = true;
    for (const triggerId of new Set(orphans)) {
      await this.options.broker.remove(triggerId).catch((error) => {
        removed = false;
        this.log(`could not remove ${triggerId}: ${String(error)}`);
      });
    }
    if (removed && inventory.unbound !== null) this.releasePending = false;
    this.save();
    for (const trigger of changed) this.emitTrigger(trigger);
    this.options.emit?.({ kind: "app-trigger.service", service: this.service() });
  }

  private async reconcileOne(trigger: StoredTrigger, bindings: Map<string, BrokerInventory["triggers"][number]>, accounts: ConnectedApps | null): Promise<void> {
    // Its bot is gone: paused here, so Composio stops sending what no one would run.
    if (trigger.enabled && this.options.botState(trigger.botId) === "missing") trigger.enabled = false;
    const account = accounts?.[trigger.app]?.accounts.find((candidate) => candidate.id === trigger.accountId);
    if (accounts && (!account || !active(account.status))) {
      if (trigger.problem?.kind !== "reconnect") trigger.problem = { kind: "reconnect", at: this.now() };
      return;
    }
    if (account && trigger.problem?.kind === "reconnect") delete trigger.problem;
    const binding = trigger.remote.triggerId ? bindings.get(trigger.remote.triggerId) : undefined;
    if (!binding || binding.remote?.state === "missing") {
      trigger.remote = { state: "pending" };
      await this.bind(trigger);
      if (!trigger.enabled && trigger.remote.triggerId) await this.options.broker.setEnabled(trigger.remote.triggerId, false);
      return;
    }
    trigger.remote = { triggerId: binding.triggerId, state: "active", syncedAt: this.now() };
    if (trigger.problem?.kind === "error" && !isEventHoldProblem(trigger.problem)) delete trigger.problem;
  }

  /** The service's drop counts never reset; today's share is what grew since the UTC day began. */
  private noteDrops(trigger: StoredTrigger, dropped: Record<string, { count: number; lastAt: number }> | undefined): void {
    if (!dropped) return;
    const day = utcDay(this.now());
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const counts = Object.fromEntries(Object.entries(dropped).map(([reason, drop]) => [reason, drop.count]));
    const base = trigger.drops?.day === day ? trigger.drops.base
      : trigger.drops ? trigger.drops.last
        : Object.fromEntries(Object.entries(dropped).map(([reason, drop]) => [reason, drop.lastAt >= dayStart ? 0 : drop.count]));
    trigger.drops = { day, base, last: counts };
    const today = (reason: string) => Math.max(0, (counts[reason] ?? 0) - (base[reason] ?? 0));
    const tooMany = trigger.skipped?.day === day ? trigger.skipped.tooMany : 0;
    trigger.skipped = { day, dailyLimit: today("daily_limit"), queueFull: today("queue_full"), expired: today("expired"), tooMany };
  }

  private countSkipped(trigger: StoredTrigger, reason: "tooMany"): void {
    const day = utcDay(this.now());
    const current = trigger.skipped?.day === day ? trigger.skipped : { day, dailyLimit: 0, queueFull: 0, expired: 0, tooMany: 0 };
    trigger.skipped = { ...current, [reason]: current[reason] + 1 };
  }

  private async resolveAccount(app: string, wanted: string | undefined): Promise<{ id: string; alias?: string }> {
    let apps: ConnectedApps;
    try {
      apps = await this.options.connectedApps();
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

  private async bind(trigger: StoredTrigger): Promise<void> {
    if (this.serviceOutOfReach()) return;
    const { triggerId } = await this.options.broker.create({ slug: trigger.event, connectedAccountId: trigger.accountId, config: trigger.config });
    trigger.remote = { triggerId, state: "active", syncedAt: this.now() };
    if (trigger.problem?.kind === "error") delete trigger.problem;
  }

  /** Several automations with the same settings share one service copy; it goes only when the last one does. */
  private async release(triggerId: string | undefined): Promise<void> {
    if (!triggerId) return;
    if (this.triggers.some((trigger) => trigger.remote.triggerId === triggerId)) {
      await this.applyEnabled(triggerId);
      return;
    }
    if (this.serviceOutOfReach()) {
      this.releasePending = true;
      return;
    }
    await this.options.broker.remove(triggerId);
  }

  private async applyEnabled(triggerId: string | undefined, alsoEnabled = false): Promise<void> {
    if (triggerId && !this.serviceOutOfReach()) await this.options.broker.setEnabled(triggerId, alsoEnabled || this.wantsEnabled(triggerId));
  }

  /** The owner's own key, or the service switched off. A service merely not reached yet still gets its calls and retries. */
  private serviceOutOfReach(): boolean {
    const service = this.options.service();
    return !service.available && service.reason !== "unavailable";
  }

  private wantsEnabled(triggerId: string): boolean {
    return this.triggers.some((trigger) => trigger.remote.triggerId === triggerId && trigger.enabled);
  }

  private markRemoteFailure(trigger: StoredTrigger, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BrokerError && error.status === 403) {
      trigger.problem = { kind: "reconnect", at: this.now() };
      trigger.remote = { ...trigger.remote, state: "error", error: message };
    } else if (error instanceof BrokerError && !error.transient) {
      trigger.problem = { kind: "error", text: message.slice(0, 300), at: this.now() };
      trigger.remote = { ...trigger.remote, state: "error", error: message };
    } else {
      trigger.remote = { ...trigger.remote, state: "pending", error: message };
      this.nextReconcileAt = Math.min(this.nextReconcileAt || Infinity, this.now() + 60_000);
    }
  }

  private setProblem(trigger: StoredTrigger, problem: NonNullable<StoredTrigger["problem"]>): void {
    trigger.problem = problem;
    this.emitTrigger(trigger);
  }

  private bound(triggerId: string | null): StoredTrigger[] {
    return triggerId ? this.triggers.filter((trigger) => trigger.remote.triggerId === triggerId) : [];
  }

  private rememberBindingOwner(remoteId: string, botId: string): void {
    const owners = this.bindingOwners.get(remoteId) ?? new Set<string>();
    owners.add(botId);
    this.bindingOwners.set(remoteId, owners);
  }

  private holdEvent(event: BrokerEvent, reason: "conflict" | "unknown", allowedTriggerIds?: string[], heldBotIds?: string[]): void {
    const existing = this.heldEvents.get(event.id);
    if (existing?.event && JSON.stringify(existing.event) !== JSON.stringify(event)) throw new RetryAppEvent("Conflicting event identity");
    const next = new Map(this.heldEvents);
    next.set(event.id, { reason: existing?.reason ?? reason, event: structuredClone(event), ...(existing ? (existing.allowedTriggerIds && existing.heldBotIds && allowedTriggerIds && heldBotIds ? { allowedTriggerIds: existing.allowedTriggerIds.filter(id => allowedTriggerIds.includes(id)), heldBotIds: [...new Set([...existing.heldBotIds, ...heldBotIds])] } : {}) : (allowedTriggerIds && heldBotIds ? { allowedTriggerIds, heldBotIds: [...new Set(heldBotIds)] } : {})) });
    const rows = [...next].map(([id, value]) => ({ id, ...value }));
    if (rows.length > MAX_HELD_EVENTS || Buffer.byteLength(JSON.stringify(rows), "utf8") > MAX_HELD_BYTES) throw new RetryAppEvent("Held event storage is full");
    try {
      mkdirSync(dirname(this.heldFile), { recursive: true });
      writeFileAtomic(this.heldFile, JSON.stringify({ version: 2, events: rows }), { mode: 0o600 });
    } catch { throw new RetryAppEvent("Held event storage is unavailable"); }
    this.heldEvents = next;
  }

  private record(trigger: StoredTrigger, event: BrokerEvent, outcome: AppEventOutcome, details: { reason?: string; runId?: string } = {}): void {
    const preview = eventPreview(event.event.data ?? {});
    const attempt: AppEventAttempt = {
      id: randomUUID(), triggerId: trigger.id, eventId: event.id.slice(0, 200), at: event.receivedAt, outcome,
      ...(details.reason ? { reason: details.reason } : {}), ...(details.runId ? { runId: details.runId } : {}), ...(preview ? { preview } : {}),
    };
    this.attemptLog.push(attempt);
    if (this.attemptLog.length > MAX_ATTEMPTS) this.attemptLog.splice(0, this.attemptLog.length - MAX_ATTEMPTS);
    this.options.emit?.({ kind: "app-trigger.attempt", botId: trigger.botId, attempt: { ...attempt } });
    this.emitTrigger(trigger);
  }

  private async remote<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BrokerError) throw new AppTriggerError(error.transient ? `The connected-apps service could not be reached (${error.message}). Try again in a minute.` : error.message, error.transient ? 503 : 400);
      throw error;
    }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work);
    this.serial = next.catch(() => undefined);
    return next;
  }

  private assertAvailable(): void {
    const service = this.options.service();
    if (service.available) return;
    throw new AppTriggerError(service.reason === "self-hosted"
      ? "App events need StartupBot's connected apps. This server uses its own Composio key, so it cannot watch apps yet: use a schedule that checks the app, or a webhook."
      : "Connected apps are not set up here, so app events are unavailable.", 409);
  }

  private assertWritable(): void {
    if (this.unreadable) throw new AppTriggerError("Saved app automations could not be read. Repair app-triggers.json before changing them.", 503);
    if (this.heldUnreadable) throw new AppTriggerError("Held app events could not be read. Restore the held event store before changing automations.", 503);
  }

  private emitTrigger(trigger: StoredTrigger): void {
    this.options.emit?.({ kind: "app-trigger", botId: trigger.botId, trigger: publicTrigger(trigger) });
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (this.options.sleep) return this.options.sleep(ms, signal);
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  private log(line: string): void {
    (this.options.log ?? ((text) => console.warn(`app events: ${text}`)))(line);
  }

  private save(overrides: { cursor?: number } = {}): void {
    for (const trigger of this.triggers) if (trigger.remote.triggerId) this.rememberBindingOwner(trigger.remote.triggerId, trigger.botId);
    if (this.unreadable) return;
    if (this.heldUnreadable) throw new RetryAppEvent("Held event storage is unavailable");
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify({
      version: 1, pollerId: this.pollerId, cursor: overrides.cursor ?? this.cursor, triggers: this.triggers, attempts: this.attemptLog, deleted: this.deleted, heldEvents: [...this.heldEvents.keys()], bindingOwners: [...this.bindingOwners].flatMap(([remoteId, owners]) => [...owners].map(botId => ({ remoteId, botId }))),
    } satisfies z.input<typeof fileSchema>, null, 2), { mode: 0o600 });
  }
}

