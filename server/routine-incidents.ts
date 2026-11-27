import { failureShape } from "./routine-outcomes.ts";

interface IncidentRun {
  id: string;
  routineId: string;
  status: string;
  scheduledFor: number;
  finishedAt?: number;
  error?: string;
  seenAt?: number;
  incidentReminderAt?: number;
}

export interface RoutineIncident {
  runs: string[];
  firstAt: number;
  lastAt: number;
  seen: boolean;
  resolved: boolean;
  reminderAt?: number;
}

// Duration normalization adapted from NousResearch/hermes-agent cron/incidents.py (MIT).
const DURATION = /\b\d+(?:\.\d+)?\s*(?:ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/gi;
const REMINDER_INTERVAL = 48 * 60 * 60_000;
const end = (run: IncidentRun) => run.finishedAt ?? run.scheduledFor;
const signature = (run: IncidentRun) => failureShape((run.error ?? "").replace(DURATION, "#s"));

/** Only pass rows visible to the caller. A successful run ends every open cause for that routine. */
export function routineIncidents(runs: readonly IncidentRun[]): Map<string, RoutineIncident> {
  const byRun = new Map<string, RoutineIncident>();
  const open = new Map<string, Map<string, RoutineIncident>>();
  const sorted = runs.filter(r => r.status === "failed" || r.status === "completed").sort((a, b) => end(a) - end(b) || a.scheduledFor - b.scheduledFor);
  for (const run of sorted) {
    const causes = open.get(run.routineId) ?? new Map<string, RoutineIncident>();
    if (run.status === "completed") {
      for (const incident of causes.values()) incident.resolved = true;
      open.delete(run.routineId);
      continue;
    }
    const key = signature(run);
    const incident = causes.get(key) ?? { runs: [], firstAt: end(run), lastAt: end(run), seen: false, resolved: false };
    incident.runs.push(run.id);
    incident.lastAt = end(run);
    incident.seen ||= run.seenAt !== undefined;
    if (run.incidentReminderAt !== undefined) incident.reminderAt = run.incidentReminderAt;
    causes.set(key, incident);
    open.set(run.routineId, causes);
    byRun.set(run.id, incident);
  }
  return byRun;
}

export function incidentReminderDue(runs: readonly IncidentRun[], run: IncidentRun): boolean {
  const incident = routineIncidents(runs.filter(r => r.routineId === run.routineId)).get(run.id);
  return !!incident && !incident.seen && (incident.runs.length === 1 || incident.lastAt - (incident.reminderAt ?? incident.firstAt) >= REMINDER_INTERVAL);
}
