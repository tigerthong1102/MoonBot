import { createHash } from "node:crypto";
import { storedOperationSchema } from "../routine-request-schemas.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}

export function prepareWorkBotRoutineOperation(operation: unknown): { operation: ReturnType<typeof storedOperationSchema.parse>; fingerprint: string } | null {
  const parsed = storedOperationSchema.safeParse(operation);
  if (!parsed.success) return null;
  return { operation: parsed.data, fingerprint: createHash("sha256").update(JSON.stringify(canonical(parsed.data))).digest("hex") };
}
