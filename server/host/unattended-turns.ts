import type { ServerTextParams } from "../../shared/server-text.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { chatNotice, failedNoticeTool, type ChatNoticeKey } from "../chat-notices.ts";
import { createLoopGuard, type LoopGuard, type LoopGuardDeps, type LoopGuardSettings } from "./loop-guard.ts";

export interface UnattendedLimits {
  maxMs: number;
  maxRequests: number;
  maxDenials: number;
}

export const UNATTENDED_DEFAULTS: UnattendedLimits = { maxMs: 4 * 60 * 60_000, maxRequests: 400, maxDenials: 5 };
const MIN_MS = 60_000;
const SWEEP_MS = 30_000;

function limit(raw: string | undefined, fallback: number, least: number): number {
  const text = raw?.trim().toLowerCase();
  if (text === "off") return Number.POSITIVE_INFINITY;
  const value = Number(text || NaN);
  return Number.isSafeInteger(value) && value >= least ? value : fallback;
}

/** OMB_UNATTENDED_TURN_MAX_MS (from 60000), OMB_UNATTENDED_TURN_MAX_REQUESTS and OMB_UNATTENDED_TURN_MAX_DENIALS (from 1):
 * whole numbers, or `off` for no limit; anything else leaves the default. */
export function unattendedLimits(env: NodeJS.ProcessEnv = process.env): UnattendedLimits {
  return {
    maxMs: limit(env.OMB_UNATTENDED_TURN_MAX_MS, UNATTENDED_DEFAULTS.maxMs, MIN_MS),
    maxRequests: limit(env.OMB_UNATTENDED_TURN_MAX_REQUESTS, UNATTENDED_DEFAULTS.maxRequests, 1),
    maxDenials: limit(env.OMB_UNATTENDED_TURN_MAX_DENIALS, UNATTENDED_DEFAULTS.maxDenials, 1),
  };
}

export const personDriven = (request: { personLine?: true; origin?: { kind: string } } | undefined): boolean =>
  request?.personLine === true || request?.origin?.kind === "user";

export interface UnattendedTurnDeps extends Omit<LoopGuardDeps, "settings"> {
  settings(unattended: boolean): LoopGuardSettings;
  unattended(threadId: string): boolean;
  limits?(): UnattendedLimits;
  now?(): number;
  timer?: boolean;
}

export interface UnattendedTurns extends LoopGuard {
  sweep(): void;
  close(): void;
}

interface Counted {
  turnId: string | undefined;
  workedMs: number;
  /** Codex and ACP engines can emit repeated usage updates for one model call. */
  calls: Set<string>;
  unnamedCalls: number;
  inStep: boolean;
  tools: number;
  denials: number;
  stopped: boolean;
}

const fresh = (turnId: string | undefined): Counted => ({ turnId, workedMs: 0, calls: new Set(), unnamedCalls: 0, inStep: false, tools: 0, denials: 0, stopped: false });

type Stop = { key: ChatNoticeKey; params: ServerTextParams };

function over(turn: Counted, limits: UnattendedLimits): Stop | undefined {
  if (turn.denials >= limits.maxDenials) return { key: "chat.notice.unattendedDenied", params: { count: turn.denials } };
  const requests = turn.calls.size + turn.unnamedCalls || turn.tools;
  if (requests >= limits.maxRequests) return { key: "chat.notice.unattendedRequests", params: { count: limits.maxRequests } };
  if (turn.workedMs >= limits.maxMs) return { key: "chat.notice.unattendedTooLong", params: { minutes: Math.round(limits.maxMs / 60_000) } };
  return undefined;
}

export function createUnattendedTurns(deps: UnattendedTurnDeps): UnattendedTurns {
  const now = deps.now ?? Date.now;
  const limits = deps.limits ?? (() => unattendedLimits());
  const loops = createLoopGuard({ ...deps, settings: (threadId) => deps.settings(deps.unattended(threadId)) });
  const turns = new Map<string, Counted>();
  let sweptAt = now();

  const stop = (threadId: string, turn: Counted, text: Stop) => {
    turn.stopped = true;
    const cause = chatNotice(text.key, text.params);
    let stopping: Promise<unknown>;
    try {
      stopping = Promise.resolve(deps.interrupt(threadId, cause));
    } catch {
      return;
    }
    (deps.log ?? console.info)(`[unattended-turn] stopped: thread=${threadId} ${text.key}`);
    deps.append(threadId, failedNoticeTool(text.key, text.params));
    void stopping.catch(() => {});
  };

  const check = (threadId: string, turn: Counted) => {
    if (turn.stopped || !deps.live(threadId) || deps.waiting(threadId) || !deps.unattended(threadId)) return;
    const text = over(turn, limits());
    if (text) stop(threadId, turn, text);
  };

  const sweep = () => {
    const at = now(), passed = Math.max(0, at - sweptAt);
    sweptAt = at;
    for (const [threadId, turn] of turns) {
      if (!deps.live(threadId)) { turns.delete(threadId); continue; }
      if (deps.waiting(threadId)) continue;
      turn.workedMs += passed;
      check(threadId, turn);
    }
  };

  const timer = deps.timer === false ? undefined : setInterval(sweep, SWEEP_MS);
  timer?.unref?.();

  const onEvent = (event: RuntimeEvent) => {
    loops.onEvent(event);
    const { threadId } = event;
    if (event.type === "turn.completed" || event.type === "session.exited") return void turns.delete(threadId);
    if (event.type === "turn.started") return void turns.set(threadId, fresh(event.turnId));
    let turn = turns.get(threadId);
    if (!turn || (event.turnId !== undefined && turn.turnId !== undefined && turn.turnId !== event.turnId)) turns.set(threadId, (turn = fresh(event.turnId)));
    if (event.type === "thread.token-usage.updated") {
      const contextOnly = event.itemId === undefined && event.input === 0 && event.output === 0
        && (event.cachedInput ?? 0) === 0 && (event.reasoning ?? 0) === 0
        && (event.contextTokens !== undefined || event.contextWindow !== undefined);
      if (contextOnly) return;
      if (event.itemId !== undefined) turn.calls.add(event.itemId);
      else if (!turn.inStep) { turn.unnamedCalls += 1; turn.inStep = true; }
    } else if (event.type === "item.started" && event.itemType === "tool") { turn.tools += 1; turn.inStep = false; }
    else if (event.type === "request.resolved" && event.behavior === "deny" && event.source !== "system" && event.source !== "user") turn.denials += 1;
    else return;
    check(threadId, turn);
  };

  return {
    onEvent, sweep,
    settle: (threadId) => { loops.settle(threadId); turns.delete(threadId); },
    close: () => { if (timer) clearInterval(timer); },
  };
}
