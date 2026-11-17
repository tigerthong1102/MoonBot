import { isRecord } from "./mcp-message-projection.ts";

export function dispatchFailedAfterLatestUser(messages: Array<Record<string, any>>): boolean {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  const turnMessages = messages.slice(lastUser + 1);
  // Only an explicit terminal receipt overrides prose. Existing providers
  // also emit diagnostics on intentional cancellation, which remain settled.
  if (turnMessages.some((message) => message.tool?.terminal === true && message.tool.ok === false)) return true;
  if (turnMessages.some((message) => message.role === "bot" && message.kind === "text" && message.text?.trim())) {
    return false;
  }
  return turnMessages.some(
    (message) =>
      message.kind === "activity" &&
      message.tool?.ok === false &&
      typeof message.tool?.name === "string" &&
      /^error:/i.test(message.tool.name.trim()),
  );
}

export function hasFailedJobRoot(job: Record<string, unknown>): boolean {
  if (job.state !== "failed" || !Array.isArray(job.nodes) || !Array.isArray(job.roots)) return false;
  const roots = job.roots;
  return job.nodes.some((node) => isRecord(node) && roots.includes(node.id) && node.status === "failed" && node.outcome !== "stopped");
}

function messageNeedsInput(message: Record<string, any>): boolean {
  const card = isRecord(message.card) && message.card.requestId && !message.card.answered && !message.card.dismissed && !message.card.expired && !message.card.quotaSwitch;
  const connector = isRecord(message.connector) &&
    !message.connector.dismissed &&
    !message.connector.resumed &&
    message.connector.status !== "connected";
  const secret = isRecord(message.secret) && !message.secret.provided && !message.secret.dismissed && !message.secret.superseded;
  const signIn = isRecord(message.signIn) && !message.signIn.done && !message.signIn.cancelled && !message.signIn.superseded && !message.signIn.answeredInChat;
  return Boolean(card || connector || secret || signIn);
}

function transcriptForJob(job: Record<string, any>, messages: Array<Record<string, any>>): Array<Record<string, any>> {
  if (!hasFailedJobRoot(job)) return messages;
  const ends = job.nodes.filter((node: unknown) => isRecord(node) && job.roots.includes(node.id) && typeof node.finishedAt === "number").map((node: Record<string, any>) => node.finishedAt as number);
  const end = ends.length ? Math.max(...ends) : null;
  const cutoff = typeof job.now === "number" ? job.now : end;
  return messages.filter((message) => (typeof message.at !== "number" || cutoff === null || message.at <= cutoff) &&
    (message.role !== "user" || typeof message.at !== "number" || end === null || message.at <= end));
}

export function jobStatus(job: Record<string, any>, messages: Array<Record<string, any>>, timedOut: boolean): "needs-user" | "timed-out" | "failed" | "stalled" | "settled" {
  const rootFailed = hasFailedJobRoot(job), transcript = transcriptForJob(job, messages);
  if (job.state === "needs-input" || (!rootFailed && transcript.some(messageNeedsInput))) return "needs-user";
  if (timedOut) return "timed-out";
  if (job.conversation?.activity === "dead") return "failed";
  if (job.conversation?.activity === "no-signal") return "stalled";
  if (dispatchFailedAfterLatestUser(transcript)) return "failed";
  const lastUser = transcript.findLastIndex((message) => message.role === "user");
  const answered = transcript.slice(lastUser + 1).some((message) => message.role === "bot" && message.kind === "text" && message.text?.trim());
  return rootFailed && !answered ? "failed" : "settled";
}
