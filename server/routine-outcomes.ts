type Outcome = { id: string; routineId: string; status: string; error?: string | null; createdAt: number; finishedAt?: number | null };

/** A routine's finished runs (failed or completed), newest first. */
export function outcomesNewestFirst<T extends Outcome>(runs: readonly T[], routineId: string, exceptRunId?: string): T[] {
  return runs.filter(run => run.routineId === routineId && run.id !== exceptRunId && (run.status === "failed" || run.status === "completed")).reverse()
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt) || b.createdAt - a.createdAt);
}

const TIME = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PATH = /(?:\b[A-Za-z]:)?(?:[\\/][\w.@~+-]+){2,}[\\/]?/g;
/** A provider's request or object id ("req_011CUa7xYz9", "msg_01…", "toolu_01…") and a long hex digest. */
const PREFIXED_ID = /\b[a-z]{2,8}_[A-Za-z0-9]{8,}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/g;
const LONG_NUMBER = /(?<![\w.-])\d{4,}(?![\w-]|\.\d)/g;

export function failureShape(text: string): string {
  return text.replace(TIME, "<time>").replace(PATH, "<path>").replace(UUID, "<id>").replace(PREFIXED_ID, "<id>")
    .replace(LONG_NUMBER, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The run failed the same way the routine's previous outcome did. */
export function failsLikeLastOutcome<T extends Outcome>(runs: readonly T[], run: T): boolean {
  const last = outcomesNewestFirst(runs, run.routineId, run.id)[0];
  return last?.status === "failed" && failureShape(last.error ?? "") === failureShape(run.error ?? "");
}
