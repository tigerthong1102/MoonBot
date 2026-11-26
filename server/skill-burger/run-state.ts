// Paused Skill Burger runs, one small file each, found by the run's id. Security invariant: a resume is taken once (the
// file is moved aside before the run goes on, so two resumes of one pause never both run its side effects), only by the
// bot that started it, and only within a day.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { interpolatedActionHash, reviewAction, type RunState } from "./runner.ts";

export const RUN_STATE_TTL_MS = 24 * 60 * 60_000;
const ID = /^[0-9a-f-]{36}(?:\.[0-9a-f-]{36})?$/;

export function createRunStates(dir: string, now: () => number = Date.now) {
  const file = (id: string) => join(dir, `${id}.json`);
  const read = (path: string): RunState | null => {
    try {
      const state = JSON.parse(readFileSync(path, "utf8")) as RunState;
      if (state.waiting?.type === "approval" && state.approvalDecision === "allow") {
        const step = state.workflow.steps.find(one => one.id === state.waiting.step);
        if (step && (step.kind === "ai" || step.kind === "decide")) {
          const detail = reviewAction(step, state.args, state.results);
          if (!detail || interpolatedActionHash(step, state.args, detail) !== state.reviewedActionHash) delete state.approvalDecision;
        }
      }
      return state;
    } catch { return null; }
  };
  const peek = (id: string, botId: string, threadId: string) => {
    if (!ID.test(id)) return null;
    const state = read(file(id));
    return state && state.botId === botId && state.threadId === threadId && now() - state.createdAt <= RUN_STATE_TTL_MS ? state : null;
  };
  const sweep = () => {
    try {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name !== "history.json" && now() - statSync(path).mtimeMs > RUN_STATE_TTL_MS) rmSync(path, { force: true });
      }
    } catch {
    }
  };
  return {
    peek,
    approvals(threadId: string, includesBot: (id: string) => boolean) {
      let names: string[];
      try { names = readdirSync(dir); } catch { return []; }
      return names.flatMap(name => {
        const claimed = name.endsWith(".json.claimed");
        const id = name.slice(0, claimed ? -13 : -5);
        if ((!claimed && !name.endsWith(".json")) || !ID.test(id)) return [];
        const state = read(join(dir, name));
        if (!state || state.threadId !== threadId || !includesBot(state.botId) || state.waiting.type !== "approval" || state.approvalDecision === "deny"
          || now() - state.createdAt > RUN_STATE_TTL_MS || state.pauseToken !== id) return [];
        return [{ state, claimed }];
      });
    },
    decide(id: string, botId: string, threadId: string, decision: "allow" | "deny", reviewedActionHash?: string) {
      const state = peek(id, botId, threadId);
      if (!state || state.waiting.type !== "approval") return null;
      if (state.approvalDecision && state.approvalDecision !== decision) return null;
      if (!state.approvalDecision) writeFileAtomic(file(id), JSON.stringify({ ...state, approvalDecision: decision, reviewedActionHash }), { mode: 0o600 });
      return state;
    },
    settleClaim(id: string) {
      if (ID.test(id)) rmSync(file(id) + ".claimed", { force: true });
    },
    save(state: RunState, preserve = false): string {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const token = preserve && state.pauseToken ? state.pauseToken : `${state.id}.${randomUUID()}`;
      writeFileAtomic(file(token), JSON.stringify({ ...state, pauseToken: token }), { mode: 0o600 });
      sweep();
      return token;
    },
    /** The newest run in `threadId` paused on the teammates' replies to `handoffs`, if any: the turn those replies resume
     * is pointed back into it. A run waiting on other hand-offs, or abandoned, is never named. */
    waitingIn(threadId: string, handoffs: readonly string[]): RunState | null {
      let newest: RunState | null = null;
      try {
        for (const name of readdirSync(dir)) {
          if (!name.endsWith(".json") || name === "history.json") continue;
          try {
            const seen = JSON.parse(readFileSync(join(dir, name), "utf8")) as RunState;
            const ours = seen.delegation?.requests.some((request) => handoffs.includes(request.requestId));
            if (seen.threadId === threadId && seen.waiting?.type === "teammates" && ours && now() - seen.createdAt <= RUN_STATE_TTL_MS && (!newest || seen.createdAt > newest.createdAt)) newest = seen;
          } catch {
          }
        }
      } catch {
        }
      return newest;
    },
    /** The paused run, taken so nobody else can resume it; null when it is gone, too old, or another bot's. */
    take(id: string, botId: string, threadId: string): RunState | null {
      const seen = peek(id, botId, threadId);
      if (!seen || (seen.waiting.type === "approval" && !seen.approvalDecision)) return null;
      const claimed = seen.waiting.type === "approval" && seen.approvalDecision === "allow";
      const taken = claimed ? file(id) + ".claimed" : `${file(id)}.taken-${now()}`;
      try {
        renameSync(file(id), taken);
      } catch {
        return null;
      }
      try {
        return read(taken);
      } finally {
        if (!claimed) rmSync(taken, { force: true });
      }
    },
  };
}
export type RunStates = ReturnType<typeof createRunStates>;
