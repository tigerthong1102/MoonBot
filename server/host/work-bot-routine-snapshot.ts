import { createHash } from "node:crypto";
import { ROUTINE_ID } from "../routine-request-schemas.ts";
import { loadSchedule } from "../routine-schedules.ts";
import type { Routine, RoutineRun } from "../routines.ts";

type Related = { botId?: string; threadId: string; moving?: boolean };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}

export function workBotRoutineSnapshot(botId: string, related: readonly Related[], routines: readonly Routine[], runs: readonly RoutineRun[]): { conflict: boolean; hasResolvedLinks: boolean; hasCompleteRecords: boolean; fingerprint: string } {
  const references = [...related].sort((a, b) => `${a.botId ?? ""}\0${a.threadId}`.localeCompare(`${b.botId ?? ""}\0${b.threadId}`));
  const matches = (entry: { botId: string; sourceThreadId?: string }) => Boolean(entry && typeof entry === "object") && entry.botId !== botId && references.some(link => entry.botId === link.botId || entry.sourceThreadId === link.threadId);
  const relatedRoutines = routines.filter(matches).map(({ id, name, prompt, botId, sourceThreadId, resultsThreadId, updatedAt, enabled, nextRunAt, target, groupId, runOn, schedule, durationMinutes, timeoutMinutes, attachments, continuity, sameConversation, modelSelection, overlap, runOnStartup, checks, access, deliver, heldFor, wakeAt, installedPackage }) => ({ id, name, prompt, botId, sourceThreadId, resultsThreadId, updatedAt, enabled, nextRunAt, target, groupId, runOn, schedule, durationMinutes, timeoutMinutes, attachments, continuity, sameConversation, modelSelection, overlap, runOnStartup, checks, access, deliver, heldFor, wakeAt, installedPackage })).sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const relatedRuns = runs.filter(run => matches(run) && ["queued", "running", "waiting"].includes(run.status)).map(({ id, routineId, routineName, prompt, durationMinutes, timeoutMinutes, attachments, target, groupId, botId, runOn, sourceThreadId, resultsThreadId, threadId, status, scheduledFor, retryAt, retried, triggerSource, eventSource, access, deliver, manual, byPerson, sameConversation, checkKey, webhookId, deliveryId }) => ({ id, routineId, routineName, prompt, durationMinutes, timeoutMinutes, attachments, target, groupId, botId, runOn, sourceThreadId, resultsThreadId, threadId, status, scheduledFor, retryAt, retried, triggerSource, eventSource, access, deliver, manual, byPerson, sameConversation, checkKey, webhookId, deliveryId })).sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const hasResolvedLinks = references.every(link => Boolean(link.botId));
  const routineIds = new Set(routines.map(routine => routine?.id));
  const runIds = new Set(runs.map(run => run?.id));
  const routineOwners = new Map(routines.filter(routine => routine && typeof routine.id === "string").map(routine => [routine.id, routine.botId]));
  const hasCompleteRecords = routineIds.size === routines.length && runIds.size === runs.length && routines.every(routine => {
    if (!routine || typeof routine !== "object" || typeof routine.id !== "string" || !ROUTINE_ID.test(routine.id) || typeof routine.botId !== "string" || !routine.botId || !Number.isSafeInteger(routine.updatedAt) || routine.updatedAt < 0 || typeof routine.enabled !== "boolean" || !(routine.nextRunAt === null || (Number.isSafeInteger(routine.nextRunAt) && routine.nextRunAt >= 0)) || !(routine.target === "bot" || routine.target === "room-goal")) return false;
    try { return Boolean(loadSchedule(routine.schedule, Date.now())); } catch { return false; }
  }) && runs.every(run => Boolean(run && typeof run === "object" && typeof run.id === "string" && ROUTINE_ID.test(run.id) && typeof run.routineId === "string" && ROUTINE_ID.test(run.routineId) && typeof run.botId === "string" && run.botId && Number.isSafeInteger(run.scheduledFor) && run.scheduledFor >= 0 && ["queued", "running", "waiting", "completed", "failed", "cancelled", "missed"].includes(run.status) && (!["queued", "running", "waiting"].includes(run.status) || routineOwners.get(run.routineId) === run.botId)));
  const conflict = !hasResolvedLinks || references.some(link => link.moving) || relatedRoutines.some(routine => routine.enabled || routine.heldFor !== undefined) || relatedRuns.length > 0;
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical({ botId, references, routines: relatedRoutines, runs: relatedRuns }))).digest("hex");
  return { conflict, hasResolvedLinks, hasCompleteRecords, fingerprint };
}
