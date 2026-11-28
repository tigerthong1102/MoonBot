import { expect, it } from "vitest";
import corpus from "./context-cases.json" with { type: "json" };
import { score, type MemoryCase } from "./score.ts";

it("keeps the answer-grounded corpus separate and reports an absent run", () => {
  const cases = corpus.cases as Array<MemoryCase & { context: string; answer: string; rationale: string }>;
  expect(corpus.version).toBe(1);
  expect(cases).toHaveLength(24);
  expect(new Set(cases.map(row => row.id)).size).toBe(cases.length);
  expect(new Set(cases.map(row => JSON.stringify([row.saved, row.query]))).size).toBe(cases.length);
  for (const split of ["development", "held-out"]) {
    const rows = cases.filter(row => row.split === split);
    expect(rows).toHaveLength(12);
    expect(rows.some(row => row.expected === "match")).toBe(true);
    expect(rows.some(row => row.expected === "none")).toBe(true);
  }
  expect(cases.every(row => row.context.trim() && row.answer.trim() && row.rationale.trim())).toBe(true);
  expect(score(cases, []).status).toBe("NOT RUN");
});
