import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const pairedRow = z.object({
  id: z.string().min(1), fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
  score: z.object({ pass: z.boolean() }), done: z.boolean(), calls: z.array(z.string()),
  answerCorrect: z.boolean().nullable(), citationCorrect: z.boolean().nullable(),
  elapsedMs: z.number().nonnegative(), costUsd: z.number().nonnegative().nullable(),
});
export type PairedRow = z.infer<typeof pairedRow>;
const report = z.object({ rows: z.array(pairedRow).min(1) });

export function fixtureHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function metrics(rows: PairedRow[]) {
  const passed = rows.filter(item => item.done && item.score.pass && item.answerCorrect !== false && item.citationCorrect !== false).length;
  const cost = rows.every(item => item.costUsd !== null) ? rows.reduce((sum, item) => sum + item.costUsd!, 0) : null;
  const citationCases = rows.filter(item => item.citationCorrect !== null);
  const times = rows.map(item => item.elapsedMs).sort((a, b) => a - b);
  return { cases: rows.length, passed, accuracy: passed / rows.length,
    citationAccuracy: citationCases.length ? citationCases.filter(item => item.done && item.citationCorrect).length / citationCases.length : null,
    p95Ms: times[Math.ceil(0.95 * times.length) - 1], toolCalls: rows.reduce((sum, item) => sum + item.calls.length, 0),
    costUsd: cost, costPerCorrectUsd: cost !== null && passed ? cost / passed : null,
    missed: { unfinished: rows.filter(item => !item.done).map(item => item.id),
      tool: rows.filter(item => !item.score.pass).map(item => item.id),
      answer: rows.filter(item => item.answerCorrect === false).map(item => item.id),
      citation: rows.filter(item => item.citationCorrect === false).map(item => item.id) } };
}

export function compareReports(base: unknown, candidate: unknown) {
  const [a, b] = [report.parse(base).rows, report.parse(candidate).rows];
  const fixtureSet = (rows: PairedRow[]) => {
    if (new Set(rows.map(item => item.id)).size !== rows.length) throw new Error("Duplicate case id");
    return JSON.stringify(rows.map(item => [item.id, item.fixtureHash]).sort(([first], [second]) => first!.localeCompare(second!)));
  };
  if (fixtureSet(a!) !== fixtureSet(b!)) throw new Error("A/B reports must use identical cases and fixture hashes");
  return { base: metrics(a!), candidate: metrics(b!) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [base, candidate] = process.argv.slice(2);
  if (!base || !candidate) throw new Error("Usage: compare.ts BASE.json CANDIDATE.json");
  console.log(JSON.stringify(compareReports(JSON.parse(readFileSync(base, "utf8")), JSON.parse(readFileSync(candidate, "utf8"))), null, 2));
}

type UsageTotal = { turns: number; unpriced: number; costUsd: number | null };

export function caseCost(before: UsageTotal, after: UsageTotal): number | null {
  if (!(after.turns > before.turns) || before.unpriced !== after.unpriced || typeof after.costUsd !== "number") return null;
  const baseline = before.costUsd ?? (before.turns === before.unpriced ? 0 : null);
  return baseline === null || after.costUsd < baseline ? null : after.costUsd - baseline;
}
