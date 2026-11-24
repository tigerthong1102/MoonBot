import type { ApprovalFields, ApprovalMode } from "../shared/approval-mode.ts";
import type { TeamSetupRequest } from "../shared/team-setup.ts";

export function workBotCreationMode(mode: ApprovalMode, hosted: boolean): ApprovalMode {
  return hosted && mode !== "custom" ? "ask" : mode;
}

export function workBotCreationPermissions(request: TeamSetupRequest, sourceExists: boolean, permission?: ApprovalMode): { bot: ApprovalFields; task: ApprovalFields } {
  if (!request.workBotOffer) return { bot: { autoApprove: false }, task: {} };
  if (!sourceExists) throw new Error("The source conversation no longer exists");
  const mode = permission ?? "ask";
  const fields = { approvalMode: mode, autoApprove: mode === "auto" };
  return { bot: fields, task: fields };
}
