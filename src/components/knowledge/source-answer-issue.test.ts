import { expect, it } from "vitest";
import { ApiError } from "@/state/api";
import { libraryOwner } from "./source-cache";
import { sourceAnswerIssue } from "./source-answer-issue";

it.each([
  ["workspace_backup_busy", "knowledge.answerMaintenance"],
  ["workspace_restore_restart", "knowledge.answerRestoreRestart"],
  ["unrecognized_service_error", "knowledge.answerNetwork"],
] as const)("shows %s from the ownership check and from the answer request", async (code, key) => {
  const read = async () => Response.json({ code }, { status: 503 });
  expect(await libraryOwner(read)).toBeNull();
  expect(await libraryOwner(read, true).catch(sourceAnswerIssue)).toBe(key);
  expect(sourceAnswerIssue(new ApiError("Service unavailable", 503, { code }))).toBe(key);
});
it.each([
  ["source_model_unavailable", "knowledge.answerModel"],
  ["source_trial_key_held", "knowledge.answerTrialKey"],
  ["source_cli_update", "knowledge.answerUpdateEngine"],
  ["source_org_blocked", "model.orgBlocked"],
  ["source_provider_unready", "knowledge.answerProviderUnavailable"],
] as const)("explains model refusal %s", (code, key) => {
  expect(sourceAnswerIssue(new ApiError("Model refused", 422, { code }))).toBe(key);
});
