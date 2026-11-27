import { expect, it } from "vitest";
import { caseCost, compareReports, fixtureHash } from "./compare.ts";

const invoice = { id: "invoice", fixtureHash: fixtureHash(["HĐ-402", 370000]), done: true, score: { pass: true }, answerCorrect: true, citationCorrect: true, elapsedMs: 100, costUsd: 0.02, calls: ["read"] };
it("compares matched cases including failures, evidence, latency and unknown prices", () => {
  const second = { ...invoice, id: "credit", elapsedMs: 500 };
  const metrics = compareReports({ rows: [invoice, second] }, { rows: [{ ...second, costUsd: null, citationCorrect: false }, invoice] });
  expect(metrics.base).toMatchObject({ passed: 2, citationAccuracy: 1, p95Ms: 500, costPerCorrectUsd: 0.02 });
  expect(metrics.candidate).toMatchObject({ passed: 1, citationAccuracy: 0.5, costPerCorrectUsd: null, missed: { citation: ["credit"] } });
  expect(() => compareReports({ rows: [invoice] }, { rows: [{ ...invoice, fixtureHash: fixtureHash("changed") }] })).toThrow("identical");
  expect(() => compareReports({ rows: [invoice, invoice] }, { rows: [invoice] })).toThrow("Duplicate");
});

it("measures the first priced case and keeps missing or unpriced increments unknown", () => {
  const empty = { turns: 0, unpriced: 0, costUsd: null };
  const paid = { turns: 1, unpriced: 0, costUsd: 0.1 };
  expect(caseCost(empty, paid)).toBe(0.1);
  expect(caseCost(empty, empty)).toBeNull();
  expect(caseCost(paid, { ...paid, turns: 2, unpriced: 1 })).toBeNull();
  expect(caseCost({ turns: 1, unpriced: 1, costUsd: null }, { turns: 2, unpriced: 1, costUsd: 0.2 })).toBe(0.2);
});
