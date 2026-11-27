import { z } from "zod";

const fieldName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/u).refine(key => !["constructor", "prototype", "sources"].includes(key));

/** A small object whose required scalar fields and permitted source references a saved workflow declares. */
export const resultContract = z.object({
  fields: z.record(fieldName, z.enum(["string", "number", "boolean"])).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 16),
  sources: z.array(z.string().trim().min(1).max(240)).min(1).max(24),
}).strict();
export type ResultContract = z.infer<typeof resultContract>;

export function delegateMessage(message: string, contract?: ResultContract): string {
  return contract ? message + "\nReturn a JSON object with these scalar fields and a sources array citing one or more listed source references: " + JSON.stringify(contract) : message;
}

export function handoffFits(input: { botIds: string[]; message: string; doneWhen?: string; rework?: boolean; consult?: boolean }): boolean {
  return JSON.stringify(input).length <= 4_000;
}

export const HANDOFF_TOO_LONG = "The handoff exceeds 4,000 characters. Shorten the task, result contract or completion criteria.";

export function resultContractError(contract: ResultContract, value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "The result must be a JSON object.";
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(k => k !== "sources" && !Object.hasOwn(contract.fields, k))) return "The result contains undeclared fields.";
  for (const [field, type] of Object.entries(contract.fields)) {
    const actual = row[field];
    if (!Object.hasOwn(row, field) || typeof actual !== type || (typeof actual === "number" && !Number.isFinite(actual))) return `The result requires ${field} of type ${type}.`;
  }
  if (!Array.isArray(row.sources) || !row.sources.length || row.sources.length > contract.sources.length ||
    new Set(row.sources).size !== row.sources.length || !row.sources.every(source => typeof source === "string" && contract.sources.includes(source))) {
    return "The result must cite one or more of the declared source references.";
  }
}
