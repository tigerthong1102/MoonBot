import { BOT_HELD_CODE, BOT_PAUSED_CODE } from "../../../shared/bot-limit";
import { lacksAdminScope } from "@/lib/admin-scope";
import { ApiError } from "@/state/api";

export type SourceAnswerIssue = "knowledge.answerAccess" | "knowledge.answerChanged" | "knowledge.answerNetwork" |
  "knowledge.answerLimit" | "knowledge.answerMoved" | "knowledge.answerBusy" | "knowledge.answerModel" | "knowledge.answerMissing" |
  "knowledge.answerHeld" | "knowledge.answerPlanPaused" | "knowledge.answerMaintenance" | "knowledge.answerReadiness" | "knowledge.sendError" | "knowledge.answerTrialKey" |
  "knowledge.answerUpdateEngine" | "knowledge.answerRestoreRestart" | "model.orgBlocked" | "knowledge.answerProviderUnavailable";

export function sourceAnswerIssue(error: unknown): SourceAnswerIssue {
  if (error instanceof ApiError) {
    const code = error.body?.code;
    switch (error.status) {
      case 401: return "knowledge.answerAccess";
      case 403: return lacksAdminScope(error) ? "knowledge.answerMissing" : "knowledge.answerAccess";
      case 404: return code === "source_conversation_missing" ? "knowledge.answerAccess" : "knowledge.answerMissing";
      case 409:
        switch (code) {
          case "spend_cap": return "knowledge.answerLimit";
          case "moved": return "knowledge.answerMoved";
          case BOT_HELD_CODE: return "knowledge.answerHeld";
          case BOT_PAUSED_CODE: return "knowledge.answerPlanPaused";
          case "source_maintenance": return "knowledge.answerMaintenance";
          default: return "knowledge.answerBusy";
        }
      case 429: return "knowledge.answerBusy";
      case 422:
        switch (code) {
          case "source_trial_key_held": return "knowledge.answerTrialKey";
          case "source_cli_update": return "knowledge.answerUpdateEngine";
          case "source_provider_unready": return "knowledge.answerProviderUnavailable";
          case "source_org_blocked": return "model.orgBlocked";
          case "source_model_unavailable": return "knowledge.answerModel";
          default: return "knowledge.answerReadiness";
        }
      case 503:
        if (code === "workspace_restore_restart") return "knowledge.answerRestoreRestart";
        if (code === "workspace_backup_busy") return "knowledge.answerMaintenance";
        return "knowledge.answerNetwork";
      case 408: case 504: return "knowledge.answerNetwork";
    }
  }
  if (error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) return "knowledge.answerNetwork";
  return "knowledge.sendError";
}
