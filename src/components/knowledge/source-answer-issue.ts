import { ApiError } from "@/state/api";

export type SourceAnswerIssue = "knowledge.answerAccess" | "knowledge.answerChanged" | "knowledge.answerNetwork" |
  "knowledge.answerLimit" | "knowledge.answerMoved" | "knowledge.answerBusy" | "knowledge.answerModel" | "knowledge.sendError";

export function sourceAnswerIssue(error: unknown): SourceAnswerIssue {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.body?.code === "spend_cap") return "knowledge.answerLimit";
    if (error.status === 409 && error.body?.code === "moved") return "knowledge.answerMoved";
    switch (error.status) {
      case 401: case 403: case 404: return "knowledge.answerAccess";
      case 409: case 429: return "knowledge.answerBusy";
      case 422: return "knowledge.answerModel";
      case 408: case 503: case 504: return "knowledge.answerNetwork";
    }
  }
  if (error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) return "knowledge.answerNetwork";
  return "knowledge.sendError";
}
