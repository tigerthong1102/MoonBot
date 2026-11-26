import { expect, it } from "vitest";
import { openReview } from "./review";
import type { Report } from "./report";

const report: Report = { company: "CT01", period: "2025", left: "3.00", right: "2.00", difference: "1.00", leftCount: 1, rightCount: 1,
  exceptions: [{ document: "00001", left: "3.00", right: "2.00", difference: "1.00", leftCount: 1, rightCount: 1, reasons: ["reconcile.different"] }] };
const entry = { document: "00001", status: "approved", assignee: "Lan", at: "2026-03-02T00:00:00Z" };
const raw = (changes: unknown[], r = report) => JSON.stringify({ version: 1, report: r, changes });
it("reopens a review with its ordered history and leading-zero identifiers", () => {
  const changes = [{ ...entry, status: "reviewing" }, entry];
  expect(openReview(raw(changes))).toEqual({ changes, report });
  expect(() => openReview(raw(changes).replace('"version":1', '"version":2'))).toThrow();
});
it("rejects a foreign voucher or unknown status/reason before changing the table", () => {
  expect(() => openReview(raw([{ ...entry, document: "1" }]))).toThrow();
  expect(() => openReview(raw([{ ...entry, status: "whatever" }]))).toThrow();
  expect(() => openReview(raw([entry], { ...report, exceptions: [{ ...report.exceptions[0]!, reasons: ["reconcile.title"] }] }))).toThrow();
});
