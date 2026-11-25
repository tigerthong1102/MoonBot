import { randomUUID } from "node:crypto";

import { harnessMcpTokenEnv } from "../harness-mcp-token.ts";
import type { BurgerTurn, StepEvent } from "./runs.ts";
import type { WorkflowGuard } from "./guarded-executors.ts";

/** The calling turn, as the agents capability names it. */
export interface CallingTurn { botId: string; threadId: string; generation: string; [field: string]: unknown }

export interface BurgerHostDeps {
  available(): boolean;
  port: number;
  cwd(botId: string, threadId: string): string;
  assignedSkills?(botId: string): readonly string[] | undefined;
  guard?(turn: CallingTurn): WorkflowGuard;
  /** A bearer of `kind` for the same turn. */
  mint(turn: CallingTurn, kind: "connectors" | "computer"): string;
  /** The bot's browser for this turn, as the turn's browser tools would get it; null while it has none. */
  browser(turn: CallingTurn): Promise<{ env?: Record<string, string | undefined> } | null>;
  /** The chat's event bus, with the engine of the turn that is running in the thread. */
  publish(threadId: string, event: Record<string, unknown>): void;
  mayEditEveryChat(): boolean;
  mayEditBot?(): boolean;
  sharedSkillsEnabled?(): boolean;
}

/** The run's view of the calling turn: `authorization` is the agents bearer the tool call came with. */
export function burgerTurn(host: BurgerHostDeps, turn: CallingTurn, authorization: string | undefined, signal?: AbortSignal): BurgerTurn {
  const post = async (path: string, token: string, body: unknown, signal: AbortSignal) => {
    try {
      const res = await fetch(`http://127.0.0.1:${host.port}${path}`, body === undefined
        ? { method: "GET", headers: { authorization: `Bearer ${token}` }, signal }
        : { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal });
      const parsed = await res.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: res.ok && !parsed.error, body: parsed, status: res.status };
    } catch (error) {
      return { ok: false, body: { error: error instanceof Error ? error.message : String(error) } };
    }
  };
  return {
    botId: turn.botId,
    threadId: turn.threadId,
    signal,
    cwd: host.cwd(turn.botId, turn.threadId),
    assignedSkills: host.assignedSkills?.(turn.botId),
    guard: host.guard?.(turn),
    mayEditEveryChat: host.mayEditEveryChat(),
    mayEditBot: host.mayEditBot?.() ?? false,
    sharedSkillsEnabled: host.sharedSkillsEnabled?.() ?? true,
    publish: (event: StepEvent) => host.publish(turn.threadId, { eventId: randomUUID(), createdAt: new Date().toISOString(), threadId: turn.threadId, itemType: "tool", ...event }),
    async internal(kind, path, body, signal) {
      if (kind === "agents") {
        const bearer = authorization?.replace(/^Bearer\s+/i, "") ?? "";
        return bearer ? post(path, bearer, body, signal) : { ok: false, body: { error: "this run has no capability" } };
      }
      if (kind === "browser") {
        const browser = await host.browser(turn).catch(() => null);
        const token = browser?.env?.[harnessMcpTokenEnv("browser")];
        return token ? post(path, token, body, signal) : { ok: false, body: { error: "this bot's browser isn't available" } };
      }
      return post(path, host.mint(turn, kind), body, signal);
    },
  };
}
