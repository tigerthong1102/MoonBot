import { isDeepStrictEqual } from "node:util";
import { appsFromCreator } from "./inherited-apps.ts";
import type { BotRecord } from "./store.ts";
import type { ApprovalFields, ApprovalMode } from "../shared/approval-mode.ts";
import { parseToolScope, type ToolScope } from "../shared/tool-scope.ts";
import type { TeamSetupRequest } from "../shared/team-setup.ts";

export function workBotCreationMode(mode: ApprovalMode, hosted: boolean): ApprovalMode {
  return hosted && mode !== "custom" ? "ask" : mode;
}

export function workBotCreationPermissions(request: TeamSetupRequest, sourceExists: boolean, permission?: ApprovalMode, sourceScope?: ToolScope): { bot: ApprovalFields & { toolScope?: ToolScope }; task: ApprovalFields } {
  if (!request.workBotOffer) return { bot: { autoApprove: false }, task: {} };
  if (!sourceExists) throw new Error("The source conversation no longer exists");
  const scope = parseToolScope(sourceScope);
  if (!scope.ok) throw new Error("The source conversation tool selection is invalid");
  const mode = permission ?? "ask";
  const fields = { approvalMode: mode, autoApprove: mode === "auto" };
  return { bot: { ...fields, ...(scope.scope ? { toolScope: scope.scope } : {}) }, task: fields };
}

export function workBotGrantsMatch(source: BotRecord, target: BotRecord): boolean {
  const expected = appsFromCreator(source, target);
  return (["composio", "connectorTools", "connectorScopes", "mcpServers"] as const).every(key => isDeepStrictEqual(expected[key], target[key]));
}
