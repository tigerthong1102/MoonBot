import { KNOWN_READ_SLUGS } from "../../shared/outbound.ts";
import { WORKFLOW_BATCH_LIMIT, type WorkflowStep } from "../../shared/skill-burger/format.ts";
import type { ExecResult, StepExecutors } from "./runner.ts";

export type BatchRowStatus = "missing_input" | "missing_result" | "read" | "pending" | "failed";

type AppStep = Extract<WorkflowStep, { kind: "app" }>;

function field(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length > 0 && value.length <= 512);

export async function runReadBatch(step: AppStep, batch: NonNullable<AppStep["batch"]>, rows: unknown, args: Record<string, unknown>,
  call: StepExecutors["app"], signal: AbortSignal, audit: BatchRowStatus[]): Promise<ExecResult> {
  if (!KNOWN_READ_SLUGS.has(step.tool) || step.app.toLowerCase() !== step.tool.split("_")[0]?.toLowerCase()) return { ok: false, error: "A batch requires a read-only connector tool." };
  if (!Array.isArray(rows) || rows.length > WORKFLOW_BATCH_LIMIT) return { ok: false, error: "The batch source must contain at most 100 rows." };
  const results = [];
  let missing = 0;
  for (const [index, data] of rows.entries()) {
    if (signal.aborted) return { ok: false, error: "The batch was stopped." };
    const row = index + 1;
    const key = field(data, batch.column);
    if (!scalar(key)) { audit[index] = "missing_input"; results.push({ row, status: "missing_input" }); missing++; continue; }
    audit[index] = "pending";
    const reply = await call({ app: step.app, tool: step.tool, account: step.account, args: { ...args, [batch.argument]: key }, signal, maxBytes: 64 * 1024 });
    if (signal.aborted) return { ok: false, error: "The batch was stopped." };
    if (!reply.ok) { audit[index] = "failed"; return { ...reply, error: "Row " + row + ": " + reply.error }; }
    let output = reply.output;
    if (typeof output === "string") {
      try { output = JSON.parse(output); } catch { output = undefined; }
    }
    const value = field(output, batch.select);
    audit[index] = scalar(value) ? "read" : "missing_result";
    if (!scalar(value)) { results.push({ row, key, status: "missing_result" }); missing++; }
    else results.push({ row, key, value, status: "read" });
  }
  return { ok: true, output: { tool: step.tool, source: batch.rows, count: rows.length, missing, rows: results } };
}
