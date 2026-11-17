// A container's cgroup pids.max limits processes and threads; exceeding it makes spawns fail with EAGAIN.
import { readFileSync } from "node:fs";
import { nameBucket, parseReapedChildrenMs, type ProcessRow } from "./perf/process-buckets.ts";
import { linuxProcessList } from "./perf/process-sampler.ts";
import { containerLimited, readPids } from "./process-limits.ts";
import type { ShortageCode } from "./process-shortage.ts";

export const ENGINE_TASKS = 60;
export const SESSION_TASKS = 40;
export const BROWSER_TASKS = 170;
const SERVER_TASKS = 40;
const SHORTAGE_HOLD_MS = 30_000;
const LEARNED_FOR_MS = 30 * 60_000;
const BROWSER_START_MS = 60_000;
const BROWSER_WAIT_MS = 20_000;
export const BROWSER_NO_ROOM = "This server is close to its limit on running programs, so another browser cannot open now. " +
  "Try the browser again in a few minutes, or carry on without it.";

export const margin = (limit: number) => Math.max(32, Math.round(limit * 0.1));
export const turnsUnder = (limit: number) => Math.max(1, Math.floor((limit - margin(limit) - SERVER_TASKS) / ENGINE_TASKS));

export type SpawnFailureCode = ShortageCode | "ENOENT" | "other";
export interface ProcessCounts {
  limit: number | null;
  spawnFailed: Record<SpawnFailureCode, number>;
  forceKilled: number;
  lateReaped: number;
}

export interface ProcessBudgetOptions {
  read?: () => { max: number | "max" | null; current: number | null };
  /** Only tasks owned by the reserved sessions may reduce their reservations. */
  browserTasks?: (sessions: readonly string[]) => number | null;
  now?: () => number;
  log?: (line: string) => void;
  pollMs?: number;
}

export class ProcessBudget {
  private readonly read: () => { max: number | "max" | null; current: number | null };
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private learned: { limit: number; at: number } | null = null;
  private holdUntil = -Infinity;
  private readonly spawnFailures: Record<SpawnFailureCode, number> = { EAGAIN: 0, EMFILE: 0, ENFILE: 0, ENOMEM: 0, ENOENT: 0, other: 0 };
  private forceKilled = 0;
  private lateReaped = 0;
  private refused: (() => void) | null = null;
  private readonly browserTasks: (sessions: readonly string[]) => number | null;
  private readonly pollMs: number;
  private readonly browsers = new Map<string, { since: number }>();
  private browserRuns: ((session: string) => boolean) | null = null;
  private browserPid: ((session: string) => number | null) | null = null;
  private seenBrowsers: { at: number; tasks: number | null; reservations: ReadonlyMap<string, { since: number }> } | null = null;

  constructor(options: ProcessBudgetOptions = {}) {
    this.read = options.read ?? (() => readPids());
    this.browserTasks = options.browserTasks ?? ((sessions) => browserTasksNow(sessions, { pid: (session) => this.browserPid?.(session) ?? null }));
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(`processes: ${line}`));
    this.pollMs = options.pollMs ?? 1_000;
  }

  onRefused(refused: () => void): void { this.refused = refused; }

  private state(): { max: number | "max" | null; current: number | null } { return this.read(); }

  limit(): number | null {
    const { max } = this.state();
    if (typeof max === "number") return max;
    if (this.learned && this.now() - this.learned.at >= LEARNED_FOR_MS) this.learned = null;
    return this.learned?.limit ?? null;
  }

  short(tasks: number, held: number): boolean {
    if (this.now() < this.holdUntil) return true;
    const limit = this.limit(), { current } = this.state();
    return limit !== null && current !== null && current + held + this.browsersHeld() + tasks > limit - margin(limit);
  }

  private browsersHeld(): number {
    const at = this.now();
    for (const [session, { since }] of this.browsers) if (at - since >= BROWSER_START_MS && this.browserRuns?.(session) === false) this.browsers.delete(session);
    const reservations = new Map([...this.browsers].filter(([session]) => this.browserRuns?.(session) === true));
    const starting = (this.browsers.size - reservations.size) * BROWSER_TASKS;
    if (!reservations.size) return starting;
    const cached = this.seenBrowsers;
    const same = cached?.reservations.size === reservations.size && [...reservations].every(([session, reservation]) => cached.reservations.get(session) === reservation);
    if (!same || !cached || at - cached.at >= 1_000 || at < cached.at) {
      this.seenBrowsers = { at, tasks: this.browserTasks([...reservations.keys()]), reservations };
    }
    return starting + Math.max(0, reservations.size * BROWSER_TASKS - (this.seenBrowsers?.tasks ?? 0));
  }

  browserRoom(runs: (session: string) => boolean, pid?: (session: string) => number | null): { enter(session: string, admitted?: (rollback: () => void) => void): Promise<string | null> } {
    this.browserRuns = runs;
    this.browserPid = pid ?? null;
    this.seenBrowsers = null;
    return { enter: (session, admitted) => this.enterBrowser(session, this.now() + BROWSER_WAIT_MS, admitted) };
  }

  reserveBrowser(session: string): void {
    const since = this.browsers.get(session)?.since;
    if (since !== undefined && (this.now() - since < BROWSER_START_MS || this.browserRuns?.(session) !== false)) return;
    this.browsers.set(session, { since: this.now() });
  }

  releaseBrowser(session: string): void { this.browsers.delete(session); }

  private async enterBrowser(session: string, until: number, admitted?: (rollback: () => void) => void): Promise<string | null> {
    for (;;) {
      const since = this.browsers.get(session)?.since;
      if (since !== undefined && (this.now() - since < BROWSER_START_MS || this.browserRuns?.(session) !== false)) return null;
      this.browsers.delete(session);
      if (this.browserRuns?.(session) || !this.short(BROWSER_TASKS, 0)) {
        const reservation = { since: this.now() };
        this.browsers.set(session, reservation);
        admitted?.(() => { if (this.browsers.get(session) === reservation && this.browserRuns?.(session) === false) this.browsers.delete(session); });
        return null;
      }
      if (this.now() >= until) return BROWSER_NO_ROOM;
      await new Promise((resolve) => { const timer = setTimeout(resolve, Math.max(1, Math.min(this.pollMs, until - this.now()))); timer.unref?.(); });
    }
  }

  spawnFailed(code: string | undefined): void {
    const known: SpawnFailureCode = code !== undefined && Object.hasOwn(this.spawnFailures, code) ? (code as SpawnFailureCode) : "other";
    this.spawnFailures[known] += 1;
    if (known === "ENOENT" || known === "other") return;
    this.holdUntil = this.now() + SHORTAGE_HOLD_MS;
    if (known === "EAGAIN") {
      const { max, current } = this.state();
      if (current !== null && typeof max !== "number") {
        const first = this.learned === null;
        this.learned = { limit: Math.min(this.learned?.limit ?? Infinity, Math.max(64, current)), at: this.now() };
        if (first) this.log(`a spawn was refused (EAGAIN) with ${current} processes and threads running; new work now waits below that count`);
      }
    }
    this.refused?.();
  }

  noteForceKilled(): void { this.forceKilled += 1; }
  noteLateReaped(): void { this.lateReaped += 1; }

  counts(): ProcessCounts {
    return { limit: this.limit(), spawnFailed: { ...this.spawnFailures }, forceKilled: this.forceKilled, lateReaped: this.lateReaped };
  }
}

export const processBudget = new ProcessBudget();

function agentBrowserSession(pid: number): string | null {
  try {
    const entries = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
    if (!entries.includes("AGENT_BROWSER_DAEMON=1")) return null;
    return entries.find((entry) => entry.startsWith("AGENT_BROWSER_SESSION="))?.slice("AGENT_BROWSER_SESSION=".length) ?? null;
  } catch { return null; }
}

export function browserTasksNow(sessions: readonly string[], {
  pid = () => null, rows = linuxProcessList().rows, sessionOf = agentBrowserSession,
}: { pid?: (session: string) => number | null; rows?: readonly ProcessRow[]; sessionOf?: (pid: number) => string | null } = {}): number | null {
  if (!rows.length) return null;
  const reserved = new Set(sessions), roots = new Set<number>();
  for (const session of sessions) { const root = pid(session); if (root !== null && Number.isSafeInteger(root) && root > 1) roots.add(root); }
  const byPid = new Map(rows.map((row) => [row.pid, row])), below = new Map<number, number[]>();
  for (const row of rows) {
    below.set(row.ppid, [...below.get(row.ppid) ?? [], row.pid]);
    if ((nameBucket(row.name) === "browser" || row.name === "agent-browser") && reserved.has(sessionOf(row.pid) ?? "")) roots.add(row.pid);
  }
  const seen = new Set<number>(), pending = [...roots];
  let tasks = 0;
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const row = byPid.get(next);
    if (!row || seen.has(next)) continue;
    seen.add(next);
    tasks += row.threads ?? 1;
    pending.push(...below.get(next) ?? []);
  }
  return tasks;
}

export interface TreeUse { cpuMs: number; children: number }

export function linuxTreeUse(pid: number, rows: () => readonly ProcessRow[] = () => linuxProcessList().rows,
  reapedMs: (pid: number) => number | null = (of) => { try { return parseReapedChildrenMs(readFileSync(`/proc/${of}/stat`, "utf8")); } catch { return null; } }): TreeUse | null {
  const below = new Map<number, ProcessRow[]>();
  let root: ProcessRow | undefined;
  for (const row of rows()) {
    if (row.pid === pid) root = row;
    else below.set(row.ppid, [...below.get(row.ppid) ?? [], row]);
  }
  if (!root) return null;
  let cpuMs = root.cpuMs + (reapedMs(pid) ?? 0), children = 0;
  const seen = new Set([pid]), queue = [...below.get(pid) ?? []];
  for (let row = queue.pop(); row; row = queue.pop()) {
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    cpuMs += row.cpuMs;
    if (row.state !== "Z" && row.state !== "X") children += 1;
    queue.push(...below.get(row.pid) ?? []);
  }
  return { cpuMs, children };
}

export type TurnsSetting = number | "auto" | "off";

/** OMB_TURNS_MAX_RUNNING: a whole number of turns at once; "off" or 0 for no gate at all; "auto", unset or anything else
 * for a number worked out from the server's memory and pids limit. */
export function turnsSetting(value: string | undefined): TurnsSetting {
  const text = value?.trim().toLowerCase();
  if (text === "off" || text === "0") return "off";
  return text && /^\d+$/.test(text) ? Number(text) : "auto";
}

export type GateHost = "cloud" | "server" | null;

export function gateHost(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, limited: () => boolean = containerLimited): GateHost {
  if ((env.OMB_CLOUD_ROLE === "home" || env.OMB_CLOUD_ROLE === "team") && platform === "linux") return "cloud";
  if (env.OMB_DESKTOP_PARENT === "1") return null;
  const setting = turnsSetting(env.OMB_TURNS_MAX_RUNNING);
  if (setting === "off") return null;
  if (typeof setting === "number" || env.OMB_TURNS_MAX_RUNNING?.trim().toLowerCase() === "auto") return "server";
  return platform === "linux" && limited() ? "server" : null;
}
