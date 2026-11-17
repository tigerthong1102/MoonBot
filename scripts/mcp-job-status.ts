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
