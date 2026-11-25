// App-event automations: the store (DATA_DIR/app-triggers.json), their copies on the connected-apps service kept in
// step without the person (reconciliation), and the long-poll that turns each queued event into a routine run. One
// path on desktop, headless and Cloud: Composio posts to the service, this server collects from it.
import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  GMAIL_APP,
  type HeldAppEventReview,
  type AppEventAttempt,
  type AppEventOutcome,
  type AppTrigger,
  type AppTriggerService,
  type AppTriggersSnapshot,
} from "../shared/app-triggers.ts";
import { AppTriggerError, cleanFilter, resolveAccount, triggerConfig, waitForAppEvents, type AppTriggerInput, type AppTriggerPatch, type ConnectedApps } from "./app-trigger-config.ts";
import { reconcileTrigger, replaceTrigger, stageTriggerUpdate, syncReplacementBinding } from "./app-trigger-mutation.ts";
import { countQueueLimit, eventDigest, fileSchema, noteDrops, publicTrigger, readHeldEvents, type HeldEvent, type StoredTrigger } from "./app-trigger-file.ts";
export { AppTriggerError, type AppTriggerInput, type AppTriggerPatch } from "./app-trigger-config.ts";
import { appLabel } from "./app-event-catalog.ts";
import { eventBlock, eventPreview, eventPrompt, matchesFilter, mergeEventBlock } from "./app-events.ts";
import { BrokerError, type AppTriggerBroker, type BrokerEvent } from "./app-trigger-broker.ts";
import { writeFileAtomic } from "./atomic.ts";
import { EVENT_HISTORY_UNAVAILABLE, LINKED_EVENT_CONFLICT, heldEventMatches, isEventHoldProblem, summarizeHeldEvents, activeBindingOwners, rememberBindingOwner } from "./app-trigger-held.ts";
import { instructionsUpdateRefusal } from "./automation-instructions.ts";
import { DATA_DIR } from "./config.ts";
import type { RoutineRunOn } from "./routines.ts";

export const DEFAULT_MAX_PENDING_RUNS = 3;
const MAX_ATTEMPTS = 2_000;
const RUN_NOW_NOTE = "A test run started from StartupBot.";
const runNowTargetSchema = z.object({ triggerId: z.string(), botId: z.string() });
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

class LinkedEventConflict extends Error {}
class RetryAppEvent extends Error {}

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
  acknowledgmentScope?: () => string | null;
  installationScope?: (signal?: AbortSignal) => Promise<string | null>;
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

export class AppTriggerManager {
  private readonly mutationCredential = new AsyncLocalStorage<{ credential: string | null }>();
  private readonly file: string;
  private readonly heldFile: string;
  private readonly now: () => number;
  private readonly options: AppTriggerManagerOptions;
  private triggers: StoredTrigger[] = [];
  private attemptLog: AppEventAttempt[] = [];
  private deleted: Array<{ at: number; trigger: StoredTrigger }> = [];
  private pollerId = randomBytes(16).toString("base64url");
  private cursor = 0;
  private cursorScope: string | undefined;
  private acknowledgedCursor = 0;
  private acknowledgedScope: string | null = null;
  private acknowledgedCredential: string | null = null;
  private cursorReview: AppTriggerService["cursorReview"];
  private cursorReviewUnannounced = false;
  private cursorReviewTimer: ReturnType<typeof setTimeout> | null = null;
  private unreadable = false;
  private mutationsInFlight = 0;
  private mutationGeneration = 0;
  private pollsInFlight = 0;
  private pollGeneration = 0;
  private usage: { plan: "desktop" | "cloud"; eventsPerDay: number; eventsToday: number } | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private failures = new Map<string, number>();
  private heldEvents = new Map<string, HeldEvent>();
  private heldUnreadable = false;
  private bindingOwners = new Map<string, Set<string>>();
  private readonly sleep: typeof waitForAppEvents;
  private stopped = true;
  private abort = new AbortController();
  private nextReconcileAt = 0;
  private loop: Promise<void> | null = null;
  private runVersion = 0;
  /** A deleted automation's service copy could not be removed yet; reconciliation removes it. */
  private releasePending = false;

  constructor(options: AppTriggerManagerOptions) {
    this.options = options;
    this.sleep = options.sleep ?? waitForAppEvents;
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
      this.cursorScope = parsed.data.cursorScope;
      this.triggers = parsed.data.triggers;
      this.attemptLog = parsed.data.attempts.slice(-MAX_ATTEMPTS);
      this.deleted = parsed.data.deleted.filter((entry) => entry.at >= this.now() - RESTORE_WINDOW_MS);
      this.heldEvents = new Map(parsed.data.heldEvents.map(row => typeof row === "string" ? [row, { reason: "conflict" as const }] : [row.id, { reason: row.reason, ...(row.event ? { event: row.event } : {}) }]));
      embeddedEvents = parsed.data.heldEvents.some(row => typeof row !== "string" && row.event !== undefined);
      for (const owner of parsed.data.bindingOwners ?? []) rememberBindingOwner(this.bindingOwners, owner.remoteId, owner.botId);
      const previousBindings = parsed.data.bindingOwners ? parsed.data.triggers.filter(trigger => trigger.enabled) : [...parsed.data.triggers, ...parsed.data.deleted.map(entry => entry.trigger)];
      for (const trigger of previousBindings) {
        if (trigger.remote.triggerId) rememberBindingOwner(this.bindingOwners, trigger.remote.triggerId, trigger.botId);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.unreadable = true;
        console.error(`app triggers: ignoring unreadable ${this.file}: ${error instanceof SyntaxError ? "invalid JSON" : error instanceof Error ? error.message : "unreadable"}`);
      }
    }
    try {
      upgradeHeldStore = readHeldEvents(this.heldFile, this.heldEvents).upgrade;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.heldUnreadable = true;
    }
    if ([...this.heldEvents.values()].some(value => !value.event)) this.heldUnreadable = true;
    if (this.options.linkedBots && !this.cursorScope && (this.cursor !== 0 || this.heldEvents.size || this.triggers.length || this.deleted.length)) this.cursorReview = "unverified";
    if (!this.heldUnreadable) for (const held of this.heldEvents.values()) {
      if (held.discarded) continue;
      const reason = held.reason === "conflict" ? LINKED_EVENT_CONFLICT : EVENT_HISTORY_UNAVAILABLE;
      for (const trigger of this.triggers) if (heldEventMatches(held, trigger) && trigger.problem?.kind !== "reconnect") trigger.problem = { kind: "error", text: reason, at: this.now() };
    }
    if (!this.heldUnreadable) for (const trigger of this.triggers) {
      if (isEventHoldProblem(trigger.problem) && !this.heldEventFor(trigger) && [...this.heldEvents.values()].some(held => held.discarded && heldEventMatches(held, trigger))) delete trigger.problem;
    }
    if ((embeddedEvents || upgradeHeldStore) && !this.heldUnreadable) {
      try {
        mkdirSync(dirname(this.heldFile), { recursive: true });
        writeFileAtomic(this.heldFile, JSON.stringify({ version: [...this.heldEvents.values()].some(value => value.discarded || value.sourceScope) ? 4 : 3, events: [...this.heldEvents].map(([id, value]) => ({ id, ...value })) }), { mode: 0o600 });
        if (embeddedEvents) this.save();
      } catch { this.heldUnreadable = true; }
    }
    if (this.options.linkedBots && (this.unreadable || this.heldUnreadable)) this.cursorReview = "event_problem";
  }

  list(): AppTrigger[] {
    return this.triggers.map(publicTrigger);
  }

  heldEventReviews(): Array<{ id: string; digest: string; reason: "conflict" | "unknown"; readyToDiscard: boolean }> {
    this.assertWritable();
    const scope = this.options.acknowledgmentScope?.() ?? null;
    return [...this.heldEvents].flatMap(([id, held]) => held.event && !held.discarded ? [{ id, digest: eventDigest(held.event), reason: held.reason, readyToDiscard: scope !== null && scope === this.acknowledgedCredential && held.sourceScope === this.acknowledgedScope && held.event.seq <= this.acknowledgedCursor }] : []);
  }

  heldEventSummaries(visible: (trigger: AppTrigger) => boolean): HeldAppEventReview[] {
    if (this.unreadable || this.heldUnreadable) return [];
    return summarizeHeldEvents(this.heldEvents.values(), this.triggers, visible);
  }

  discardHeldEvent(id: string, digest: string): void {
    this.assertWritable();
    const held = this.heldEvents.get(id);
    if (held?.discarded) {
      if (held.eventDigest !== digest) throw new AppTriggerError("This held event changed or is not ready for review.", 409);
      this.publishDiscardedEvent(held);
      return;
    }
    const scope = this.options.acknowledgmentScope?.() ?? null;
    if (!held?.event || eventDigest(held.event) !== digest || held.event.seq > this.cursor || !scope || scope !== this.acknowledgedCredential || !held.sourceScope || held.sourceScope !== this.acknowledgedScope || held.event.seq > this.acknowledgedCursor || this.mutationsInFlight) throw new AppTriggerError("This held event changed or is not ready for review.", 409);
    const { seq, kind, triggerId, receivedAt } = held.event;
    const next = new Map(this.heldEvents);
    const discarded: HeldEvent = { reason: held.reason, event: { id, seq, kind, triggerId, receivedAt, event: {} }, discarded: true, eventDigest: digest, sourceScope: held.sourceScope,
      ...(held.heldBotIds ? { heldBotIds: held.heldBotIds } : {}), ...(held.heldTriggerIds ? { heldTriggerIds: held.heldTriggerIds } : {}) };
    next.set(id, discarded);
    try { writeFileAtomic(this.heldFile, JSON.stringify({ version: 4, events: [...next].map(([key, value]) => ({ id: key, ...value })) }), { mode: 0o600 }); }
    catch { throw new AppTriggerError("Held event storage is unavailable.", 503); }
    this.heldEvents = next;
    this.publishDiscardedEvent(discarded);
  }

  private publishDiscardedEvent(held: HeldEvent): void {
    for (const trigger of this.triggers) if (heldEventMatches(held, trigger)) {
      if (isEventHoldProblem(trigger.problem) && !this.heldEventFor(trigger)) delete trigger.problem;
      this.emitTrigger(trigger);
    }
  }

  mutationActivity(): "unreadable" | "changing" | "no-mutation" {
    return this.unreadable || this.heldUnreadable ? "unreadable" : this.mutationsInFlight > 0 ? "changing" : "no-mutation";
  }

  private async trackMutation<T>(work: () => Promise<T>): Promise<T> {
    this.mutationsInFlight++;
    this.mutationGeneration++;
    try {
      const credential = this.options.acknowledgmentScope?.() ?? null;
      if (this.options.linkedBots) {
        this.assertWritable();
        if (this.cursorReview === "unverified" || this.cursorReview === "changed" || this.options.service().available) {
          const scope = this.options.installationScope ? await this.readInstallationScope() : credential;
          this.assertCredential(credential);
          this.assertCursorScope(scope);
        }
      }
      return await this.mutationCredential.run({ credential }, () => this.options.broker.withCurrentAccount?.(work) ?? work());
    } finally { this.mutationsInFlight--; }
  }

  private assertMutationCredential(): void {
    const current = this.mutationCredential.getStore();
    if (this.options.linkedBots && current) this.assertCredential(current.credential);
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
    const review = this.cursorReview ? { cursorReview: this.cursorReview } : {};
    if (!service.available) return { available: false, reason: service.reason, ...review };
    return { available: true, ...this.usage, ...review };
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
    const account = await resolveAccount(this.options.connectedApps, app, input.account);
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
      this.assertMutationCredential();
      if (this.triggers.some((candidate) => candidate.id === trigger.id)) throw new AppTriggerError("An automation with this id already exists.", 409);
      this.assertNoDuplicate(trigger, true);
      try {
        await this.bind(trigger);
        await this.applyEnabled(trigger.remote.triggerId, trigger.enabled);
      } catch (error) {
        this.assertMutationCredential();
        // Composio refused this config: nothing to save. Anything else is retried by reconciliation.
        if (error instanceof BrokerError && !error.transient && error.status !== 403) throw new AppTriggerError(error.message, 400);
        this.markRemoteFailure(trigger, error);
      }
      this.assertMutationCredential();
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
    const found = this.triggers.find((candidate) => candidate.id === id);
    if (!found) return null;
    const trigger: StoredTrigger = found;
    const updateBaseline = structuredClone({ app: trigger.app, event: trigger.event, config: trigger.config, filter: trigger.filter });
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
      this.assertMutationCredential();
      if (!this.triggers.includes(trigger)) throw new AppTriggerError("This automation was removed. Refresh and try again.", 409);
      const effectiveConfig = reconfigure ? config : trigger.config;
      const effectiveFilter = patch.filter === undefined ? trigger.filter : filter;
      if (options.protectInstructions) {
        const refusal = instructionsUpdateRefusal(trigger.prompt, patch.prompt);
        if (refusal) throw new AppTriggerError(refusal, 409);
      }
      if (reconfigure && !isDeepStrictEqual({ app: trigger.app, event: trigger.event, config: trigger.config, filter: trigger.filter }, updateBaseline)) throw new AppTriggerError("This automation changed while it was being edited. Refresh and try again.", 409);
      if ((patch.enabled ?? trigger.enabled) && (patch.enabled === true || patch.prompt !== undefined || reconfigure)) {
        this.assertNoDuplicate({ ...trigger, enabled: true, prompt: patch.prompt === undefined ? trigger.prompt : patch.prompt.trim(), config: effectiveConfig, filter: effectiveFilter }, false);
      }
      const previous = trigger.remote.triggerId;
      const previousConfig = JSON.stringify(trigger.config);
      const staged = stageTriggerUpdate(trigger, patch, name, effectiveConfig, effectiveFilter, this.now());
      const sync = (id: string | undefined) => syncReplacementBinding(id, trigger, staged, this.triggers, () => this.serviceOutOfReach(), this.options.broker, () => { this.releasePending = true; });
      try {
        if (reconfigure && (!previous || JSON.stringify(config) !== previousConfig)) {
          staged.remote = { state: "pending" };
          await this.bind(staged);
          await sync(previous);
        }
        await sync(staged.remote.triggerId);
      } catch (error) {
        this.assertMutationCredential();
        this.markRemoteFailure(staged, error);
      }
      this.assertMutationCredential();
      replaceTrigger(trigger, staged);
      this.save();
      if (patch.enabled === false) this.options.runs.cancelQueued(trigger.id, "The automation was paused before this event's run started");
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
      this.assertMutationCredential();
      if (!this.triggers.includes(trigger)) throw new AppTriggerError("This automation was removed. Refresh and try again.", 409);
      let releaseFailed = false;
      const remoteId = trigger.remote.triggerId;
      try {
        if (remoteId && !this.serviceOutOfReach()) {
          const remaining = this.triggers.filter(candidate => candidate !== trigger && candidate.remote.triggerId === remoteId);
          if (remaining.length) await this.options.broker.setEnabled(remoteId, remaining.some(candidate => candidate.enabled));
          else await this.options.broker.remove(remoteId);
        } else if (remoteId) releaseFailed = true;
      } catch (error) {
        this.assertMutationCredential();
        this.log(`could not remove ${remoteId ?? id} from the connected-apps service yet: ${String(error)}`);
        releaseFailed = true;
      }
      this.assertMutationCredential();
      this.triggers = this.triggers.filter((candidate) => candidate !== trigger);
      this.deleted = [...this.deleted.filter((entry) => entry.at >= this.now() - RESTORE_WINDOW_MS && entry.trigger.id !== id),
        { at: this.now(), trigger: structuredClone(trigger) }].slice(-MAX_DELETED);
      this.save();
      this.options.runs.cancelQueued(id, "The automation was deleted before this event's run started");
      if (releaseFailed) {
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
      this.assertMutationCredential();
      const entry = this.deleted.find((candidate) => candidate.trigger.id === id && candidate.at >= this.now() - RESTORE_WINDOW_MS);
      if (!entry || this.triggers.some((trigger) => trigger.id === id)) return null;
      if (this.options.botState(entry.trigger.botId) === "missing") throw new AppTriggerError("The assigned bot no longer exists.", 410);
      const trigger: StoredTrigger = { ...structuredClone(entry.trigger), remote: { state: "pending" }, updatedAt: this.now() };
      if (trigger.enabled) this.assertNoDuplicate(trigger, false);
      try { await this.bind(trigger); await this.applyEnabled(trigger.remote.triggerId, trigger.enabled); }
      catch (error) { this.assertMutationCredential(); this.markRemoteFailure(trigger, error); }
      this.assertMutationCredential();
      this.deleted = this.deleted.filter((candidate) => candidate !== entry);
      this.triggers.unshift(trigger);
      this.save();
      this.emitTrigger(trigger);
      this.wake();
      return publicTrigger(trigger);
    });
  }

  private assertNoDuplicate(trigger: StoredTrigger, checkSameBotWhenDisabled: boolean): void {
    const duplicate = this.triggers.find(existing => existing.id !== trigger.id && existing.enabled && existing.event === trigger.event &&
      existing.accountId === trigger.accountId && existing.prompt === trigger.prompt && isDeepStrictEqual(existing.config, trigger.config) &&
      (existing.botId === trigger.botId ? trigger.enabled || checkSameBotWhenDisabled : trigger.enabled && this.options.linkedBots?.(existing.botId, trigger.botId)));
    if (duplicate) throw new AppTriggerError("A matching automation may already be active. Review the existing automation before creating another.", 409);
  }

  /** A test event marked as one, sent through the service's real queue when the automation has its copy there. */
  async runNow(id: string): Promise<{ via: "service" | "here"; runId?: string } | null> {
    return this.trackMutation(() => this.runNowTracked(id));
  }

  private async runNowTracked(id: string): Promise<{ via: "service" | "here"; runId?: string } | null> {
    this.assertWritable();
    const trigger = this.triggers.find((candidate) => candidate.id === id);
    if (!trigger) return null;
    const data = { omb_test: true, note: RUN_NOW_NOTE };
    if (trigger.remote.triggerId && trigger.remote.state === "active" && this.options.service().available) {
      try {
        await this.options.broker.testEvent(trigger.remote.triggerId, { ...data, omb_test_target: { triggerId: trigger.id, botId: trigger.botId } });
        this.wake();
        return { via: "service" };
      } catch (error) {
        if (error instanceof BrokerError && error.transient) throw new AppTriggerError("Test delivery could not be confirmed. Check recent runs before trying again.", 503);
        throw new AppTriggerError(error instanceof Error ? error.message : String(error), 502);
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
    if (this.cursorReviewUnannounced) this.setCursorReview(this.cursorReview);
    this.abort = new AbortController();
    this.nextReconcileAt = 0;
    this.loop = this.run(++this.runVersion).catch((error) => this.log(`app events stopped: ${error instanceof Error ? error.message : String(error)}`));
  }

  async stop(): Promise<void> {
    const loop = this.loop;
    this.stopped = true;
    if (this.cursorReviewTimer) clearTimeout(this.cursorReviewTimer);
    this.cursorReviewTimer = null;
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
      return this.exclusive(async () => {
        this.assertWritable();
        this.assertMutationCredential();
        const before = this.triggers.map(trigger => ({ trigger, value: structuredClone(trigger) }));
        try { await this.reconcileNow(); }
        catch (error) {
          const context = this.mutationCredential.getStore();
          if (this.options.linkedBots && context && context.credential !== (this.options.acknowledgmentScope?.() ?? null)) {
            for (const { trigger, value } of before) {
              replaceTrigger(trigger, value);
            }
          }
          throw error;
        }
      });
    });
  }

  /** Handles one batch in order. The cursor (the service's ack) moves only after the runs and this file are saved:
   *  a crash before that brings the same events back, and each event's run receipt stops a second run. */
  receive(events: BrokerEvent[], cursor: number, sourceScope: string | null = this.options.acknowledgmentScope?.() ?? null): void {
    this.assertWritable();
    if (this.heldUnreadable) throw new RetryAppEvent("Held event storage is unavailable");
    this.assertCursorScope(sourceScope);
    let next = this.cursor;
    try {
      for (const event of events) {
        try {
          this.handle(event, sourceScope);
        } catch (error) {
          if (error instanceof RetryAppEvent) throw error;
          if (error instanceof LinkedEventConflict) {
            this.holdEvent(event, error.message === LINKED_EVENT_CONFLICT ? "conflict" : "unknown", undefined, undefined, undefined, sourceScope);
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

  private handle(event: BrokerEvent, sourceScope: string | null): void {
    if (event.kind === "account_expired") {
      const accountId = event.event.data?.connected_account_id;
      for (const trigger of this.triggers.filter((candidate) => candidate.accountId === accountId)) this.setProblem(trigger, { kind: "reconnect", at: this.now() });
      return;
    }
    if (event.kind === "trigger_disabled") {
      for (const trigger of this.bound(event.triggerId)) this.setProblem(trigger, { kind: "reconnect", at: this.now() });
      return;
    }
    const held = this.heldEvents.get(event.id);
    if (held?.discarded) {
      if (held.sourceScope !== sourceScope || held.eventDigest !== eventDigest(event)) throw new RetryAppEvent("Conflicting event identity");
      return;
    }
    if (held?.sourceScope && sourceScope !== held.sourceScope) throw new RetryAppEvent("Conflicting event source");
    if (held?.event && JSON.stringify(held.event) !== JSON.stringify(event)) throw new RetryAppEvent("Conflicting event identity");
    if (this.options.linkedBots && this.mutationsInFlight) throw new RetryAppEvent(EVENT_HISTORY_UNAVAILABLE);
    let data = event.event.data ?? {};
    let allBound = this.bound(event.triggerId);
    if (event.kind === "test" && Object.hasOwn(data, "omb_test_target")) {
      const { omb_test_target, ...payload } = data;
      const target = runNowTargetSchema.safeParse(omb_test_target);
      const selected = target.success ? this.triggers.find(trigger => trigger.id === target.data.triggerId && trigger.botId === target.data.botId) : undefined;
      if (selected && !allBound.includes(selected)) {
        this.record(selected, { ...event, event: {} }, "skipped", { reason: "This automation changed event sources before the test arrived. Use Run now to test its current source." });
      }
      allBound = selected && allBound.includes(selected) ? [selected] : [];
      data = payload;
    } else if (event.kind === "test" && (allBound.length > 1 || data.omb_truncated === true || (data.omb_test === true && data.note === RUN_NOW_NOTE))) {
      for (const trigger of allBound) {
        this.record(trigger, { ...event, event: {} }, "skipped", { reason: "This test has no verified destination. Use Run now on the intended automation." });
      }
      return;
    }
    const bound = held ? allBound.filter(trigger => held.allowedTriggerIds?.includes(trigger.id)) : allBound;
    if (held) for (const trigger of this.triggers) if (heldEventMatches(held, trigger)) this.emitTrigger(trigger);
    if (held && !this.options.linkedBots) throw new RetryAppEvent(EVENT_HISTORY_UNAVAILABLE);
    if (held && (!held.allowedTriggerIds || !held.heldBotIds || !held.heldTriggerIds)) return;
    const candidates = bound.filter(trigger => this.options.runs.receipt(trigger.id, event.id) || (trigger.enabled && this.options.botState(trigger.botId) !== "missing" && matchesFilter(trigger.app, trigger.filter, data)));
    if (this.options.linkedBots) {
      const affected = new Set<StoredTrigger>();
      let reason = LINKED_EVENT_CONFLICT;
      try {
        if (!this.options.runs.eventRecipients) throw new Error("Event receipt lookup unavailable");
        const previous = this.options.runs.eventRecipients(event.id);
        for (const candidate of candidates) if (held?.heldBotIds?.some(bot => bot === candidate.botId || this.options.linkedBots!(bot, candidate.botId))) affected.add(candidate);
        const owners = event.triggerId && event.kind !== "test" ? [...(this.bindingOwners.get(event.triggerId) ?? [])] : [];
        const possiblyBound = event.kind === "test" ? bound : bound.filter(trigger => owners.includes(trigger.botId));
        possiblyBound.forEach((first, index) => possiblyBound.slice(index + 1).forEach(second => {
          const conflict = first.botId === second.botId
            ? first.prompt === second.prompt && candidates.includes(first) && candidates.includes(second)
            : this.options.linkedBots!(first.botId, second.botId);
          if (conflict) { affected.add(first); affected.add(second); }
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
        this.holdEvent(event, reason === LINKED_EVENT_CONFLICT ? "conflict" : "unknown", allowedTriggerIds, [...affected].map(trigger => trigger.botId), [...affected].map(trigger => trigger.id), sourceScope);
        const changed = [...affected].filter(trigger => trigger.problem?.kind !== "reconnect" && (trigger.problem?.kind !== "error" || trigger.problem.text !== reason));
        for (const trigger of changed) trigger.problem = { kind: "error", text: reason, at: this.now() };
        for (const trigger of changed) this.emitTrigger(trigger);
        for (let index = bound.length - 1; index >= 0; index--) if (!allowedTriggerIds.includes(bound[index]!.id)) bound.splice(index, 1);
      }
    }
    for (const trigger of bound) {
      if (isEventHoldProblem(trigger.problem) && !this.heldEventFor(trigger)) {
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
          countQueueLimit(this.now(), trigger);
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
      if (trigger.problem?.kind === "reconnect" && event.kind === "message") this.restoreHeldProblem(trigger);
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
    const onlyPoll = this.pollsInFlight++ === 0;
    const pollGeneration = ++this.pollGeneration;
    const mutationGeneration = this.mutationGeneration;
    const mutationFree = this.mutationsInFlight === 0;
    try {
    this.assertWritable();
    const after = this.cursor;
    const credential = this.options.acknowledgmentScope?.() ?? null;
    const scope = this.options.installationScope ? await this.readInstallationScope(signal) : credential;
    if (signal?.aborted) return 0;
    this.assertCredential(credential);
    this.assertCursorScope(scope);
    let response: Awaited<ReturnType<AppTriggerBroker["poll"]>>;
    try { response = await this.options.broker.poll({ after, waitS, poller: this.pollerId, signal }); }
    catch (error) { if (this.options.linkedBots && !signal?.aborted) this.setCursorUnavailable(); throw error; }
    if (signal?.aborted) return 0;
    const currentCredential = this.options.acknowledgmentScope?.() ?? null;
    if (credential !== currentCredential) { this.acknowledgedScope = null; this.acknowledgedCredential = null; this.acknowledgedCursor = 0; if (this.options.linkedBots) this.setCursorUnavailable(); throw new RetryAppEvent("Connected-app account changed during polling"); }
    if (!scope) { this.acknowledgedScope = null; this.acknowledgedCredential = null; this.acknowledgedCursor = 0; }
    else { if (this.acknowledgedScope !== scope) this.acknowledgedCursor = 0; this.acknowledgedScope = scope; this.acknowledgedCredential = credential; this.acknowledgedCursor = Math.max(this.acknowledgedCursor, after); }
    try { if (response.events.length || response.cursor > this.cursor) this.receive(response.events, response.cursor, scope); }
    catch (error) { if (this.options.linkedBots) this.setCursorReview("event_problem"); throw error; }
    if (this.options.linkedBots && scope && onlyPoll && mutationFree && this.pollsInFlight === 1 && this.pollGeneration === pollGeneration && this.mutationsInFlight === 0 && this.mutationGeneration === mutationGeneration && !response.events.length && response.cursor === after && this.cursor === after) {
      this.forgetInactiveBindingOwners();
    }
    if (this.options.linkedBots) this.setCursorReview(undefined);
    return response.events.length;
    } finally { this.pollsInFlight--; }
  }

  private assertCredential(credential: string | null): void {
    if (credential === (this.options.acknowledgmentScope?.() ?? null)) return;
    if (this.options.linkedBots) this.setCursorUnavailable();
    throw new RetryAppEvent("Connected-app account changed during identity verification");
  }

  private async readInstallationScope(signal?: AbortSignal): Promise<string | null> {
    try { return await this.options.installationScope!(signal); }
    catch (error) { if (!signal?.aborted) this.setCursorUnavailable(); throw error; }
  }

  private pollable(): boolean {
    return this.options.service().available && this.triggers.some((trigger) => trigger.enabled && trigger.remote.triggerId);
  }
  private async reconcileNow(): Promise<void> {
    if (!this.options.service().available) return;
    const credential = this.options.acknowledgmentScope?.() ?? null;
    if (this.options.linkedBots) {
      const scope = this.options.installationScope ? await this.readInstallationScope() : credential;
      this.assertCredential(credential);
      this.assertCursorScope(scope);
    }
    const inventory = await this.options.broker.inventory();
    this.assertCredential(credential);
    this.usage = { plan: inventory.limits.plan, eventsPerDay: inventory.limits.eventsPerDay, eventsToday: inventory.usage.eventsToday };
    const accounts = await this.options.connectedApps().catch(() => null);
    this.assertCredential(credential);
    const bindings = new Map(inventory.triggers.map((binding) => [binding.triggerId, binding]));
    const changed = new Set<StoredTrigger>();
    for (const trigger of this.triggers) {
      const before = JSON.stringify(trigger);
      const staged = structuredClone(trigger);
      try {
        this.assertCredential(credential);
        await reconcileTrigger(staged, bindings, accounts, { botState: this.options.botState, restoreHeld: trigger => this.restoreHeldProblem(trigger),
          bind: trigger => this.bind(trigger), assertCredential: () => this.assertCredential(credential), broker: this.options.broker, now: this.now });
      } catch (error) {
        this.assertCredential(credential);
        this.markRemoteFailure(staged, error);
      }
      this.assertCredential(credential);
      noteDrops(this.now(), staged, staged.remote.triggerId ? bindings.get(staged.remote.triggerId)?.dropped : undefined);
      replaceTrigger(trigger, staged);
      if (JSON.stringify(trigger) !== before) changed.add(trigger);
    }
    const wanted = new Set(this.triggers.map((trigger) => trigger.remote.triggerId).filter((id): id is string => Boolean(id)));
    for (const triggerId of wanted) {
      this.assertCredential(credential);
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
      this.assertCredential(credential);
      await this.options.broker.remove(triggerId).catch((error) => {
        removed = false;
        this.log(`could not remove ${triggerId}: ${String(error)}`);
      });
    }
    this.assertCredential(credential);
    if (removed && inventory.unbound !== null) this.releasePending = false;
    this.save();
    for (const trigger of changed) this.emitTrigger(trigger);
    this.options.emit?.({ kind: "app-trigger.service", service: this.service() });
  }

  private async bind(trigger: StoredTrigger): Promise<void> {
    if (this.serviceOutOfReach()) return;
    const { triggerId } = await this.options.broker.create({ slug: trigger.event, connectedAccountId: trigger.accountId, config: trigger.config });
    trigger.remote = { triggerId, state: "active", syncedAt: this.now() };
    if (trigger.problem?.kind === "error") delete trigger.problem;
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

  private heldEventFor(trigger: StoredTrigger) {
    return [...this.heldEvents.values()].find(held => !held.discarded && heldEventMatches(held, trigger));
  }

  private restoreHeldProblem(trigger: StoredTrigger): void {
    const held = this.heldEventFor(trigger);
    if (!held) { delete trigger.problem; return; }
    trigger.problem = { kind: "error", text: held.reason === "conflict" ? LINKED_EVENT_CONFLICT : EVENT_HISTORY_UNAVAILABLE, at: this.now() };
  }

  private forgetInactiveBindingOwners(): void {
    const next = activeBindingOwners(this.triggers);
    if (isDeepStrictEqual(next, this.bindingOwners)) return;
    const previous = this.bindingOwners;
    this.bindingOwners = next;
    try { this.save(); } catch (error) { this.bindingOwners = previous; throw error; }
  }

  private holdEvent(event: BrokerEvent, reason: "conflict" | "unknown", allowedTriggerIds?: string[], heldBotIds?: string[], heldTriggerIds?: string[], sourceScope: string | null = null): void {
    const existing = this.heldEvents.get(event.id);
    if (existing?.event && JSON.stringify(existing.event) !== JSON.stringify(event)) throw new RetryAppEvent("Conflicting event identity");
    const next = new Map(this.heldEvents);
    next.set(event.id, { reason: existing?.reason ?? reason, event: structuredClone(event), ...(existing?.sourceScope ? { sourceScope: existing.sourceScope } : !existing && sourceScope ? { sourceScope } : {}), ...(existing ? (existing.allowedTriggerIds && existing.heldBotIds && allowedTriggerIds && heldBotIds ? { allowedTriggerIds: existing.allowedTriggerIds.filter(id => allowedTriggerIds.includes(id)), heldBotIds: [...new Set([...existing.heldBotIds, ...heldBotIds])], ...(existing.heldTriggerIds && heldTriggerIds ? { heldTriggerIds: [...new Set([...existing.heldTriggerIds, ...heldTriggerIds])] } : {}) } : {}) : (allowedTriggerIds && heldBotIds && heldTriggerIds ? { allowedTriggerIds, heldBotIds: [...new Set(heldBotIds)], heldTriggerIds: [...new Set(heldTriggerIds)] } : {})) });
    const rows = [...next].map(([id, value]) => ({ id, ...value }));
    if (rows.filter(row => !row.discarded).length > MAX_HELD_EVENTS || Buffer.byteLength(JSON.stringify(rows), "utf8") > MAX_HELD_BYTES) throw new RetryAppEvent("Held event storage is full");
    try {
      mkdirSync(dirname(this.heldFile), { recursive: true });
      writeFileAtomic(this.heldFile, JSON.stringify({ version: rows.some(row => row.discarded || row.sourceScope) ? 4 : 3, events: rows }), { mode: 0o600 });
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
    if (this.unreadable) { if (this.options.linkedBots) this.setCursorReview("event_problem"); throw new AppTriggerError("Saved app automations could not be read. Repair app-triggers.json before changing them.", 503); }
    if (this.heldUnreadable) { if (this.options.linkedBots) this.setCursorReview("event_problem"); throw new AppTriggerError("Held app events could not be read. Restore the held event store before changing automations.", 503); }
  }

  private assertCursorScope(scope: string | null): void {
    if (!this.options.linkedBots) return;
    if (!scope) { this.setCursorUnavailable(); throw new RetryAppEvent("The connected-app account could not be verified."); }
    if (this.cursorScope && this.cursorScope !== scope) { this.setCursorReview("changed"); throw new RetryAppEvent("Connected-app account changed; review the saved event cursor before continuing."); }
    if (this.cursorScope) return;
    if (this.cursorReview === "unverified" || this.cursor !== 0 || this.heldEvents.size) { this.setCursorReview("unverified"); throw new RetryAppEvent("The saved event cursor has no verified account; review it before continuing."); }
    this.cursorScope = scope;
    try { this.save(); }
    catch (error) { this.cursorScope = undefined; this.setCursorReview("event_problem"); throw error; }
  }

  private setCursorUnavailable(): void {
    this.setCursorReview(this.cursorReview && this.cursorReview !== "unavailable" ? this.cursorReview : "unavailable");
  }

  private setCursorReview(issue: AppTriggerService["cursorReview"]): void {
    if (this.cursorReview === issue && !this.cursorReviewUnannounced) return;
    this.cursorReview = issue;
    try { this.options.emit?.({ kind: "app-trigger.service", service: this.service() }); this.cursorReviewUnannounced = false; }
    catch {
      this.cursorReviewUnannounced = true;
      if (!this.stopped && !this.cursorReviewTimer) {
        this.cursorReviewTimer = setTimeout(() => { this.cursorReviewTimer = null; if (this.cursorReviewUnannounced) this.setCursorReview(this.cursorReview); }, 1_000);
        this.cursorReviewTimer.unref?.();
      }
    }
  }

  private emitTrigger(trigger: StoredTrigger): void {
    this.options.emit?.({ kind: "app-trigger", botId: trigger.botId, trigger: publicTrigger(trigger) });
  }

  private log(line: string): void {
    (this.options.log ?? ((text) => console.warn(`app events: ${text}`)))(line);
  }

  private save(overrides: { cursor?: number } = {}): void {
    for (const trigger of this.triggers) if (trigger.enabled && trigger.remote.triggerId) rememberBindingOwner(this.bindingOwners, trigger.remote.triggerId, trigger.botId);
    if (this.unreadable) return;
    if (this.heldUnreadable) throw new RetryAppEvent("Held event storage is unavailable");
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify({
      version: 1, pollerId: this.pollerId, cursor: overrides.cursor ?? this.cursor, ...(this.cursorScope ? { cursorScope: this.cursorScope } : {}), triggers: this.triggers, attempts: this.attemptLog, deleted: this.deleted, heldEvents: [...this.heldEvents.keys()], bindingOwners: [...this.bindingOwners].flatMap(([remoteId, owners]) => [...owners].map(botId => ({ remoteId, botId }))),
    } satisfies z.input<typeof fileSchema>, null, 2), { mode: 0o600 });
  }
}

