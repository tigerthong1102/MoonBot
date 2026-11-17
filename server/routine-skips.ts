import { ROUTINE_DEFERRAL_NOTICE_MS } from "./routine-execution.ts";
import { codedLine, type RoutineLine, type RoutineLineKey } from "./routine-lines.ts";
import type { RoutineRun } from "./routines.ts";

/** What a `missed` row stands for when it counts skipped occurrences. */
export interface RoutineSkips {
  /** Occurrences skipped for this cause. */
  count: number;
  /** The scheduled times of the first and the last of them. */
  firstAt: number;
  lastAt: number;
  behind: string;
  /** The owner was told about this cause. */
  told?: true;
}

export type SkipWhy = Extract<RoutineLineKey, "routines.server.part.stillWaiting" | "routines.server.part.stillRunning" | "routines.server.part.notStarted" | "routines.server.part.computerNoStart" | "routines.server.part.runsFailed"
  | "routines.server.part.restartedSoon">;

/** A run of the same routine that an occurrence is skipped behind, and, for one that waits, since when. */
export function blockingRun(runs: readonly RoutineRun[], routineId: string): { run: RoutineRun; why: SkipWhy; waitingSince?: number } | undefined {
  const active = runs.filter((run) => run.routineId === routineId && ["queued", "running", "waiting"].includes(run.status));
  const run = active.find((candidate) => candidate.status === "waiting" && candidate.waitingSince !== undefined) ?? active.find((candidate) => candidate.status !== "queued") ?? active[0];
  if (!run) return undefined;
  if (run.status === "waiting" && run.waitingSince !== undefined) return { run, why: "routines.server.part.stillWaiting", waitingSince: run.waitingSince };
  return { run, why: run.status === "queued" ? "routines.server.part.notStarted" : "routines.server.part.stillRunning" };
}

export function recordSkip(runs: readonly RoutineRun[], make: () => RoutineRun, cause: { behind: string; waitingSince?: number } & ({ why: SkipWhy } | { words: (count: number) => RoutineLine }), scheduledFor: number, now: number,
  earlier?: { count: number; scheduledFor: number }): { row: RoutineRun; added: boolean; tell: boolean } {
  const found = runs.findLast((run) => run.status === "missed" && run.skipped?.behind === cause.behind);
  const row = found ?? make(), count = 1 + (earlier?.count ?? 0);
  const skipped: RoutineSkips = found?.skipped
    ? { ...found.skipped, count: found.skipped.count + count, lastAt: Math.max(found.skipped.lastAt, scheduledFor) }
    : { count, firstAt: earlier?.scheduledFor ?? scheduledFor, lastAt: scheduledFor, behind: cause.behind };
  const tell = !skipped.told && cause.waitingSince !== undefined && scheduledFor >= cause.waitingSince + ROUTINE_DEFERRAL_NOTICE_MS;
  if (tell) skipped.told = true;
  const atStart = "why" in cause && cause.why === "routines.server.part.restartedSoon";
  const line = "words" in cause ? cause.words(skipped.count)
    : skipped.count === 1 ? codedLine("error", atStart ? "routines.server.startSkippedOne" : "routines.server.skippedOne", { why: cause.why })
    : codedLine("error", atStart ? "routines.server.startSkippedMany" : "routines.server.skippedMany", { count: skipped.count, why: cause.why });
  Object.assign(row, line.codes, { status: "missed", error: line.text, finishedAt: now, skipped } satisfies Partial<RoutineRun>);
  if (tell) delete row.seenAt;
  else if (!found) row.seenAt = now;
  return { row, added: !found, tell };
}

/** Skip counts as routines.json may hold them; anything out of shape is dropped. */
export function loadSkips(value: unknown): RoutineSkips | undefined {
  const skips = value as Partial<RoutineSkips> | null | undefined;
  if (!skips || typeof skips !== "object" || !Number.isSafeInteger(skips.count) || skips.count! < 1 || !Number.isSafeInteger(skips.firstAt) || !Number.isSafeInteger(skips.lastAt) ||
    typeof skips.behind !== "string" || !/^[\w:-]{1,160}$/.test(skips.behind)) return undefined;
  return { count: skips.count!, firstAt: skips.firstAt!, lastAt: skips.lastAt!, behind: skips.behind, ...(skips.told === true ? { told: true } : {}) };
}
