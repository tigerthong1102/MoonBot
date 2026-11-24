import { createHash } from "node:crypto";
import { storedOperationSchema } from "../routine-request-schemas.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

export function prepareWorkBotRoutineOperation(operation: unknown): { operation: ReturnType<typeof storedOperationSchema.parse>; fingerprint: string } | null {
  const parsed = storedOperationSchema.safeParse(operation);
  if (!parsed.success) return null;
  const prepared = freezeTree(parsed.data);
  return Object.freeze({ operation: prepared, fingerprint: createHash("sha256").update(JSON.stringify(canonical(prepared))).digest("hex") });
}
