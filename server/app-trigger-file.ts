import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { APP_FILTER_MAX, type AppTrigger } from "../shared/app-triggers.ts";
import { brokerEventSchema, type BrokerEvent } from "./app-trigger-broker.ts";

export const filterSchema = z.object({
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
export type StoredTrigger = z.output<typeof storedSchema>;
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
export const fileSchema = z.object({
  version: z.literal(1),
  pollerId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  cursor: z.number().int().nonnegative(),
  cursorScope: z.string().min(1).max(128).optional(),
  triggers: z.array(storedSchema),
  attempts: z.array(attemptSchema).default([]),
  deleted: z.array(z.object({ at: z.number(), trigger: storedSchema })).default([]),
  heldEvents: z.array(z.union([z.string(), z.object({ id: z.string(), reason: z.enum(["conflict", "unknown"]), event: brokerEventSchema.optional() })])).default([]),
  bindingOwners: z.array(z.object({ remoteId: z.string(), botId: z.string() })).optional(),
});
const heldStoreSchema = z.object({ version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), events: z.array(z.object({ id: z.string(), reason: z.enum(["conflict", "unknown"]), event: brokerEventSchema.optional(), allowedTriggerIds: z.array(z.string()).optional(), heldBotIds: z.array(z.string()).optional(), heldTriggerIds: z.array(z.string()).optional(), discarded: z.literal(true).optional(), eventDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), sourceScope: z.string().min(1).max(128).optional() })) });
export type HeldEvent = { reason: "conflict" | "unknown"; event?: BrokerEvent; allowedTriggerIds?: string[]; heldBotIds?: string[]; heldTriggerIds?: string[]; discarded?: true; eventDigest?: string; sourceScope?: string };
export const eventDigest = (event: BrokerEvent) => createHash("sha256").update(JSON.stringify(event)).digest("hex");

export function publicTrigger(stored: StoredTrigger): AppTrigger {
  const { drops: _drops, ...trigger } = stored;
  return structuredClone(trigger);
}

export function readHeldEvents(file: string, heldEvents: Map<string, HeldEvent>): { upgrade: boolean } {
  const stored = heldStoreSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (new Set(stored.events.map(row => row.id)).size !== stored.events.length) throw new Error("Duplicate held event IDs");
  for (const row of stored.events) {
    if (row.event && row.event.id !== row.id) throw new Error("Mismatched held event ID");
    if ((row.discarded || row.sourceScope) && stored.version !== 4) throw new Error("Invalid held event version");
    if (row.discarded && (!row.event || !row.eventDigest || !row.sourceScope)) throw new Error("Invalid discarded event receipt");
    if (row.heldTriggerIds && (!row.heldTriggerIds.length || !row.heldBotIds?.length || row.heldTriggerIds.some(id => row.allowedTriggerIds?.includes(id)))) throw new Error("Conflicting held recipient IDs");
    const existing = heldEvents.get(row.id);
    if (existing?.event && row.event && JSON.stringify(existing.event) !== JSON.stringify(row.event) && (!row.discarded || eventDigest(existing.event) !== row.eventDigest)) throw new Error("Conflicting held event copies");
    const event = row.event ?? existing?.event;
    heldEvents.set(row.id, { reason: row.reason, ...(event ? { event } : {}), ...(row.allowedTriggerIds ? { allowedTriggerIds: row.allowedTriggerIds } : {}), ...(row.heldBotIds ? { heldBotIds: row.heldBotIds } : {}), ...(row.heldTriggerIds ? { heldTriggerIds: row.heldTriggerIds } : {}), ...(row.sourceScope ? { sourceScope: row.sourceScope } : {}), ...(row.discarded ? { discarded: true as const, eventDigest: row.eventDigest } : {}) });
  }
  return { upgrade: stored.version < 3 };
}

const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** The service's drop counts never reset; today's share is what grew since the UTC day began. */
export function noteDrops(now: number, trigger: StoredTrigger, dropped: Record<string, { count: number; lastAt: number }> | undefined): void {
  if (!dropped) return;
  const day = utcDay(now);
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

export function countQueueLimit(now: number, trigger: StoredTrigger): void {
  const day = utcDay(now);
  const current = trigger.skipped?.day === day ? trigger.skipped : { day, dailyLimit: 0, queueFull: 0, expired: 0, tooMany: 0 };
  trigger.skipped = { ...current, tooMany: current.tooMany + 1 };
}
