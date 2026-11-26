export interface WorkflowWait {
  run: string;
  botId: string;
  token: string;
  name: string;
  step: string;
  message: string;
  action: string;
  state: "pending" | "approved" | "interrupted" | "unavailable";
}

export function isWorkflowWait(value: unknown): value is WorkflowWait {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.run !== "string" || !row.run || typeof row.token !== "string" || !row.token ||
      typeof row.botId !== "string" || !row.botId || typeof row.name !== "string" || typeof row.step !== "string" ||
      typeof row.message !== "string" || typeof row.action !== "string") return false;
  if (row.state === "interrupted" || row.state === "unavailable") return true;
  return (row.state === "pending" || row.state === "approved") && row.action.trim().length > 0;
}
