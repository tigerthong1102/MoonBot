import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { codedLine, type RoutineLine, type RoutineLineKey } from "../routine-lines.ts";
import { serverLine, type ServerLineKey } from "../server-lines.ts";
import { hostTimeZone } from "../turn-clock.ts";
import { CAP_FIELDS, capsFromEnv, capStates, effectiveCaps, reachedCap, type CapLimits, type CapState, type CapStops, type UsageCapsConfig } from "../usage-caps.ts";

export const USAGE_CAP_CODE = "spend_cap";

export interface UsageCapView {
  stops: CapStops;
  savedStops: CapStops;
  server: CapLimits;
  bots: Record<string, CapLimits>;
  env: { stops: boolean; server: Array<keyof CapLimits>; values: { stops?: CapStops; server: CapLimits } };
  caps: CapState[];
}

export interface UsageCapGate {
  assertTurn(botId: string | undefined, personWaiting: boolean, language?: string): void;
  refusal(botId: string | undefined, personWaiting: boolean, language?: string): string | null;
  routineSkip(botId: string, routineId: string): { behind: string; resetsAt: number; words(count: number): RoutineLine } | null;
  runText(botId: string, trigger: string | undefined, language?: string): string | null;
  handoff(botId: string, origin: "user" | "outside" | undefined): string | null;
  booked(botId: string): void;
  view(): UsageCapView;
}

type Marks = Record<string, { period: string; limit: number; warn?: true; reached?: true }>;

export function marksOf(value: unknown): Marks {
  const marks: Marks = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return marks;
  for (const [id, raw] of Object.entries(value)) {
    const mark = raw as Partial<Marks[string]> | null;
    if (id === "__proto__" || !mark || typeof mark !== "object" || typeof mark.period !== "string" || !/^\d{4}-\d{2}(-\d{2})?$/.test(mark.period) ||
      typeof mark.limit !== "number" || !Number.isFinite(mark.limit)) continue;
    marks[id] = { period: mark.period, limit: mark.limit, ...(mark.warn === true ? { warn: true } : {}), ...(mark.reached === true ? { reached: true } : {}) };
  }
  return marks;
}

const NAME: Record<`${CapState["scope"]}:${CapState["period"]}`, { line: ServerLineKey; part: RoutineLineKey }> = {
  "server:day": { line: "server.usageCap.name.serverDay", part: "routines.server.part.capServerDay" },
  "server:month": { line: "server.usageCap.name.serverMonth", part: "routines.server.part.capServerMonth" },
  "bot:day": { line: "server.usageCap.name.botDay", part: "routines.server.part.capBotDay" },
  "bot:month": { line: "server.usageCap.name.botMonth", part: "routines.server.part.capBotMonth" },
};

export const capAmount = (unit: CapState["unit"], value: number): string =>
  unit === "usd" ? `$${value.toFixed(2)}` : `${Math.round(value).toLocaleString("en-US")} tokens`;

export function capResets(at: number, timeZone = hostTimeZone()): string {
  return `${new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })} (${timeZone})`;
}

export function createUsageCapGate(deps: {
  dataDir: string;
  caps(): UsageCapsConfig | undefined;
  botName(botId: string): string | undefined;
  notice(aboutBotId: string | undefined, title: string, body: string): void;
  log(line: string): void;
  language?(): string | undefined;
  now?(): Date;
  env?: NodeJS.ProcessEnv;
}): UsageCapGate {
  const env = deps.env ?? process.env;
  const now = () => deps.now?.() ?? new Date();
  const file = join(deps.dataDir, "usage", "cap-notices.json");
  let marks: Marks | undefined;

  const load = (): Marks => {
    if (marks) return marks;
    try {
      marks = marksOf(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      marks = {};
    }
    return marks;
  };
  const save = () => {
    try {
      mkdirSync(join(deps.dataDir, "usage"), { recursive: true, mode: 0o700 });
      writeFileAtomic(file, JSON.stringify(marks), { mode: 0o600 });
    } catch {
    }
  };

  const nameOf = (state: CapState, language?: string) =>
    serverLine(language, NAME[`${state.scope}:${state.period}`].line, { bot: deps.botName(state.botId ?? "") ?? "" });
  const refusedWords = (state: CapState, language?: string) => serverLine(language, "server.usageCap.refused",
    { cap: nameOf(state, language), limit: capAmount(state.unit, state.limit), resets: capResets(state.resetsAt) });

  const first = (state: CapState, what: "warn" | "reached"): boolean => {
    const all = load();
    const saved = all[state.id];
    const mark = saved && saved.period === state.periodKey && saved.limit === state.limit ? saved : { period: state.periodKey, limit: state.limit };
    if (mark[what] || (what === "warn" && mark.reached)) return false;
    all[state.id] = { ...mark, warn: true, ...(what === "reached" ? { reached: true as const } : {}) };
    for (const [id, old] of Object.entries(all)) if (old.period.length === state.periodKey.length && old.period < state.periodKey) delete all[id];
    save();
    return true;
  };

  const announce = (state: CapState, aboutBotId: string | undefined) => {
    const stops = effectiveCaps(deps.caps(), env).stops;
    if (state.reached) {
      if (!first(state, "reached")) return;
      const language = deps.language?.();
      const params = { cap: nameOf(state, language), limit: capAmount(state.unit, state.limit), resets: capResets(state.resetsAt) };
      deps.log(`usage cap reached: ${state.id} ${capAmount(state.unit, state.used)} of ${capAmount(state.unit, state.limit)}; ${stops === "everything" ? "all new work" : "unattended work"} waits until ${new Date(state.resetsAt).toISOString()}`);
      deps.notice(state.botId ?? aboutBotId, serverLine(language, "server.usageCap.noticeTitle"),
        serverLine(language, stops === "everything" ? "server.usageCap.noticeEverything" : "server.usageCap.noticeUnattended", params));
    } else if (state.warn && first(state, "warn")) {
      deps.log(`usage cap at ${state.percent}%: ${state.id} ${capAmount(state.unit, state.used)} of ${capAmount(state.unit, state.limit)}`);
    }
  };

  const blocking = (botId: string | undefined, personWaiting: boolean): CapState | null => {
    const state = reachedCap(deps.caps(), deps.dataDir, { ...(botId ? { botId } : {}), personWaiting }, now(), env);
    if (state) announce(state, botId);
    return state;
  };

  return {
    refusal(botId, personWaiting, language) {
      const state = blocking(botId, personWaiting);
      return state ? refusedWords(state, language) : null;
    },
    assertTurn(botId, personWaiting, language) {
      const state = blocking(botId, personWaiting);
      if (state) throw Object.assign(new Error(refusedWords(state, language)), { status: 409, code: USAGE_CAP_CODE, resetsAt: state.resetsAt });
    },
    routineSkip(botId, routineId) {
      const state = blocking(botId, false);
      if (!state) return null;
      const params = { why: NAME[`${state.scope}:${state.period}`].part, amount: capAmount(state.unit, state.limit), resets: capResets(state.resetsAt) };
      return {
        behind: `cap:${routineId}:${state.id}:${state.periodKey}`.replace(/[^\w:-]/g, "-").slice(0, 160), resetsAt: state.resetsAt,
        words: (count) => count === 1 ? codedLine("error", "routines.server.capSkippedOne", params) : codedLine("error", "routines.server.capSkippedMany", { count, ...params }),
      };
    },
    runText(botId, trigger, language) {
      return this.refusal(botId, trigger === "manual", language);
    },
    handoff(botId, origin) {
      const state = blocking(botId, origin === "user");
      if (!state) return null;
      const name = deps.botName(botId) ?? "that bot";
      return `Nothing was handed to @${name}: ${nameOf(state)} (${capAmount(state.unit, state.limit)}) is reached, and nobody is waiting on this work. `
        + `Work like this starts again by itself after ${capResets(state.resetsAt)}. Say that in one line and stop. Do not retry, and do not hand this to another bot to work around the cap.`;
    },
    booked(botId) {
      for (const state of capStates(deps.caps(), deps.dataDir, now(), env, botId)) announce(state, botId);
    },
    view() {
      const saved = deps.caps();
      const fromEnv = capsFromEnv(env);
      return {
        stops: effectiveCaps(saved, env).stops, savedStops: saved?.stops ?? "unattended", server: saved?.server ?? {}, bots: saved?.bots ?? {},
        env: { stops: fromEnv.stops !== undefined, server: CAP_FIELDS.map(({ field }) => field).filter((field) => fromEnv.server[field] !== undefined), values: fromEnv },
        caps: capStates(saved, deps.dataDir, now(), env),
      };
    },
  };
}
