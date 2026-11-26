export interface WorkflowWait {
  run: string;
  token: string;
  name: string;
  step: string;
  message: string;
  action: string;
  state: "pending" | "approved" | "interrupted" | "unavailable";
}
