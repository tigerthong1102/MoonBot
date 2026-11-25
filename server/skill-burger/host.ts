import { allowsTool, narrowsNativeTools, parseToolScope } from "../../shared/tool-scope.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Store } from "../store.ts";
import type { createWorkflowApprovals } from "./approval.ts";
import type { WorkflowGuard } from "./guarded-executors.ts";
import type { RunHistory } from "./history.ts";
import { createSkillBurgerRoutes, createStandaloneSkillBurgerRoutes, type SkillBurgerRouteDeps } from "./routes.ts";
import type { CallingTurn } from "./turn-host.ts";

interface WorkflowHostDeps {
  store: Pick<Store, "activePath" | "bots" | "bot" | "taskByThread">;
  team: boolean;
  enabled(): boolean;
  sees: SkillBurgerRouteDeps["sees"];
  levelOf: NonNullable<SkillBurgerRouteDeps["levelOf"]>;
  active(turn: CallingTurn): boolean;
  scope(botId: string): unknown;
  approvals: ReturnType<typeof createWorkflowApprovals>;
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
          if (action === "browser") return allowsTool(scope, { kind: "mcp", server: "browser", name: "browser_navigate" });
          return Boolean(name && allowsTool(scope, { kind: "mcp", server: "composio", name }) && allowsTool(scope, { kind: "mcp", server: "composio", name: "COMPOSIO_MULTI_EXECUTE_TOOL" }));
        } catch { return false; }
      },
      approve: (action, summary, signal) => deps.approvals.ask({ threadId: turn.threadId, tool: `Workflow: ${action}`, summary, signal, active }),
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
  return { guard, routes };
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
