import { redactSecretsInText } from "../../shared/redact.ts";
import type { StepExecutors } from "./runner.ts";

export type WorkflowAction = "shell" | "vm" | "app" | "browser" | "file" | "delegate" | "edit";
export interface WorkflowGuard {
  allowed(action: WorkflowAction, name?: string): boolean;
  approve(action: WorkflowAction, summary: string, signal: AbortSignal): Promise<boolean>;
}

export async function authorizeWorkflowAction(guard: WorkflowGuard, action: WorkflowAction, name: string | undefined, input: unknown, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || !guard.allowed(action, name)) return false;
  const summary = redactSecretsInText(JSON.stringify(input));
  if (summary.length > 4_000) return false;
  return await guard.approve(action, summary, signal) && !signal.aborted && guard.allowed(action, name);
}

export function guardedExecutors(exec: StepExecutors, guard: WorkflowGuard): StepExecutors {
  const permits = (action: WorkflowAction, name: string | undefined, input: unknown, signal: AbortSignal) => authorizeWorkflowAction(guard, action, name, input, signal);
  const denied = { ok: false as const, error: "Permission denied, unavailable, or expired; the action was not executed" };
  return {
    ...exec,
    shell: async (input) => await permits(input.where === "vm" ? "vm" : "shell", input.tool, { command: input.command, cwd: input.cwd, env: input.env, stdin: input.stdin }, input.signal) ? exec.shell(input) : denied,
    app: async (input) => await permits("app", input.tool, { app: input.app, tool: input.tool, account: input.account, args: input.args }, input.signal) ? exec.app(input) : denied,
    browser: async (input) => await permits("browser", "browser_navigate", { url: input.url }, input.signal) ? exec.browser(input) : denied,
    file: async (input) => await permits("file", undefined, { path: input.path, content: input.content }, input.signal) ? exec.file(input) : denied,
    ...(exec.delegate ? { delegate: async (input: Parameters<NonNullable<StepExecutors["delegate"]>>[0]) => await permits("delegate", "coordinate_bots", { botIds: input.botIds, message: input.message, doneWhen: input.doneWhen, rework: input.rework, consult: input.consult }, input.signal) ? exec.delegate!(input) : { ...denied, definitive: true } } : {}),
  };
}
