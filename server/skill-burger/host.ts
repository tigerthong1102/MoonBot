import { allowsTool, narrowsNativeTools, parseToolScope } from "../../shared/tool-scope.ts";
import { hasDesktopOwnerCapability, type RequestAuth } from "../request-auth.ts";
import type { Store } from "../store.ts";
import { groupTurnCwd } from "../room-cwd.ts";
import type { createWorkflowApprovals } from "./approval.ts";
import type { WorkflowAction, WorkflowGuard } from "./guarded-executors.ts";
import { workflowApprovalRoutes } from "./approval-routes.ts";
import type { SkillBurgerRuns } from "./runs.ts";
import type { RunHistory } from "./history.ts";
import { createSkillBurgerRoutes, createStandaloneSkillBurgerRoutes, type SkillBurgerRouteDeps } from "./routes.ts";
import type { CallingTurn } from "./turn-host.ts";

interface WorkflowHostDeps {
  store: Pick<Store, "activePath" | "bots" | "bot" | "taskByThread" | "groupByThread">;
  team: boolean;
  enabled(): boolean;
  sees: SkillBurgerRouteDeps["sees"];
  levelOf: NonNullable<SkillBurgerRouteDeps["levelOf"]>;
  active(turn: CallingTurn): boolean;
  scope(botId: string): unknown;
  approvals: ReturnType<typeof createWorkflowApprovals>;
  auto(turn: CallingTurn, action: WorkflowAction, input: unknown): "allow" | "ask" | "deny";
}

export function createWorkflowHost(deps: WorkflowHostDeps) {
  const { store } = deps;
  function guard(turn: CallingTurn): WorkflowGuard {
    const active = () => deps.active(turn);
    return {
      allowed(action, name) {
        if (!active() || action === "file") return false;
        try {
          const scope = deps.scope(turn.botId);
          if (action === "shell") return !narrowsNativeTools(scope);
          if (action === "vm" || action === "delegate" || action === "edit") return allowsTool(scope, { kind: "mcp", server: "agents", name: action === "vm" ? "vm_exec" : action === "edit" ? "workflow_edit" : "coordinate_bots" });
          if (action === "browser") return allowsTool(scope, { kind: "mcp", server: "browser", name: "agent_browser_open" });
          return Boolean(name && allowsTool(scope, { kind: "mcp", server: "composio", name }) && allowsTool(scope, { kind: "mcp", server: "composio", name: "COMPOSIO_MULTI_EXECUTE_TOOL" }));
        } catch { return false; }
      },
      approve: (action, summary, signal, input) => {
        const decision = deps.auto(turn, action, input);
        if (decision !== "ask") return Promise.resolve(decision === "allow" && active() && !signal.aborted);
        return deps.approvals.ask({ threadId: turn.threadId, tool: `Workflow: ${action}`, summary, signal, active });
      },
    };
  }
  function routes(history: Pick<RunHistory, "list">) {
    const extras = {
      history,
      teammate: (auth: RequestAuth, idOrName: string) => {
        const visible = store.bots.filter((one) => deps.levelOf(auth, one.id) !== "none");
        const bot = visible.find((one) => one.id === idOrName) ?? visible.find((one) => one.name.toLowerCase() === idOrName.toLowerCase());
        return bot ? { id: bot.id, name: bot.name, ...(bot.title ? { role: bot.title } : {}) } : undefined;
      },
    };
    return deps.team ? createSkillBurgerRoutes({
      available: (auth) => auth.kind === "session",
      requiresShareConsent: () => true,
      messages: (threadId) => store.activePath(threadId),
      botIds: () => store.bots.map((bot) => bot.id),
      owns: (botId, threadId) => store.bot(botId)?.threadId === threadId || Boolean(store.taskByThread(botId, threadId)),
      sees: deps.sees,
      levelOf: deps.levelOf,
      assignedSkills: (botId) => store.bot(botId)?.assignedSkills,
      ...extras,
    }) : createStandaloneSkillBurgerRoutes(store, deps.sees, deps.enabled, extras);
  }
  function reviewRoutes(approvals: SkillBurgerRuns["approvals"], reviewer: {
    live(id: string): boolean; ownerToken(): string | undefined; localBrowserIdle(): boolean;
  }) {
    const mayReview = (auth: RequestAuth, threadId: string) => (deps.team || deps.enabled()) && deps.sees(auth, threadId)
      && (auth.kind === "session" ? !auth.session.token && reviewer.live(auth.session.id) : !deps.team && auth.trust !== "service");
    // The message route requires chat access to every room bot. A reviewer must additionally edit the originating bot.
    const roomMembers = (auth: RequestAuth, threadId: string) => {
      const group = store.groupByThread(threadId);
      return group && group.memberIds.every(id => ["edit", "chat"].includes(deps.levelOf(auth, id))) ? group : null;
    };
    return workflowApprovalRoutes({
      approvals,
      roomEditors: (auth, groupId, threadId) => {
        if (!mayReview(auth, threadId)) return null;
        const group = roomMembers(auth, threadId);
        return group?.id === groupId ? group.memberIds.filter(id => deps.levelOf(auth, id) === "edit") : null;
      },
      sees: (auth, botId, threadId) => Boolean(mayReview(auth, threadId) && deps.levelOf(auth, botId) === "edit"
        && (store.bot(botId)?.threadId === threadId || store.taskByThread(botId, threadId) || roomMembers(auth, threadId)?.memberIds.includes(botId))),
      human: (auth, req) => auth.kind === "session" || Boolean(auth.companionDevice)
        || hasDesktopOwnerCapability(req, reviewer.ownerToken()) || Boolean(req.headers.origin && reviewer.localBrowserIdle()),
    });
  }
  return { guard, routes, reviewRoutes };
}

export function workflowAutoDecision(mode: string, action: WorkflowAction, input: unknown, floor: { blocked(command: string): boolean; clears(command: string): boolean }): "allow" | "ask" | "deny" {
  if (mode !== "full") return "ask";
  if (action !== "shell" && action !== "vm") return "allow";
  const command = input && typeof input === "object" && "command" in input ? input.command : undefined;
  if (typeof command !== "string") return "ask";
  if (floor.blocked(command)) return "deny";
  return floor.clears(command) ? "allow" : "ask";
}

export function createToolScopeForTurn(botById: (id: string) => { toolScope?: unknown } | null | undefined) {
  return (botId: string) => {
    const bot = botById(botId);
    if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
    const parsed = parseToolScope(bot.toolScope);
    if (!parsed.ok) throw Object.assign(new Error("This bot's tool selection is invalid. Open Access settings and save a valid selection before starting a turn."), { status: 409, code: "tool_scope" });
    return parsed.scope;
  };
}

export function workflowCwd(store: Pick<Store, "groupByThread" | "pinGroupCwd" | "taskByThread" | "bot">, workspace: (botId: string) => string, botId: string, threadId: string): string {
  const group = store.groupByThread(threadId);
  if (group) return groupTurnCwd(workspace(botId), () => store.pinGroupCwd(group.id, threadId))!;
  return store.taskByThread(botId, threadId)?.cwd || store.bot(botId)?.cwd || workspace(botId);
}
