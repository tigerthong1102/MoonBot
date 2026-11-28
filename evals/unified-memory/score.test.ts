import { describe, expect, it } from "vitest";
import corpus from "./cases.json" with { type: "json" };
import { score, type MemoryCase } from "./score.ts";

const cases = corpus.cases as MemoryCase[];
describe("semantic recall score", () => {
  it("keeps a missing run separate from a perfect score", () => {
    const result = score(cases, []);
    expect(result.status).toBe("NOT RUN");
    expect(Object.values(result.cells).every(cell => cell.attempted === 0 && cell.correct === 0)).toBe(true);
  });
  it("accounts for false matches, false misses and errors separately", () => {
    const result = score(cases.slice(0, 2), [{ id: cases[0]!.id, result: "none" }, { id: cases[1]!.id, result: "error" }]);
    expect(result.status).toBe("COMPLETE");
    expect(result.cells["development/paraphrase"]).toEqual({ total: 2, positives: 2, negatives: 0, attempted: 2, errors: 1, correct: 0, falseMatch: 0, falseMiss: 1 });
    const negative = cases.find(row => row.expected === "none")!;
    const other = score([negative], [{ id: negative.id, result: "match" }]);
    expect(other.cells[`${negative.split}/${negative.category}`]!.falseMatch).toBe(1);
  });
  it("refuses unknown and duplicated predictions and reports partial coverage", () => {
    expect(() => score(cases, [{ id: "unknown", result: "match" }])).toThrow();
    expect(() => score(cases, [{ id: cases[0]!.id, result: "match" }, { id: cases[0]!.id, result: "match" }])).toThrow();
    expect(score(cases, [{ id: cases[0]!.id, result: "match" }]).status).toBe("INCOMPLETE");
  });
  it("has unique hand-authored cases in both splits and outcome classes", () => {
    expect(new Set(cases.map(row => row.id)).size).toBe(cases.length);
    for (const split of ["development", "held-out"]) {
      const selected = cases.filter(row => row.split === split);
      expect(selected.some(row => row.expected === "match")).toBe(true);
      expect(selected.some(row => row.expected === "none")).toBe(true);
    }
  });
});
