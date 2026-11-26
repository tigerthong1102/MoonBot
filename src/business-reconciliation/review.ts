import type { Report } from "./report";

export const reviewStatuses = ["open", "reviewing", "approved"] as const;
export type ReviewStatus = typeof reviewStatuses[number];
export interface ReviewChange {
  document: string;
  at: string;
  assignee: string;
  status: ReviewStatus;
}

function changesFor(value: { version?: number; changes?: ReviewChange[] }, report: Report): ReviewChange[] {
  if (value?.version !== 1 || !Array.isArray(value.changes) || value.changes.length > 100_000) throw new Error("invalid review");
  const documents = new Set(report.exceptions.map(row => row.document));
  return value.changes.map((item: ReviewChange) => {
    if (!item || !documents.has(item.document) || !reviewStatuses.includes(item.status) ||
        typeof item.assignee !== "string" || item.assignee.length > 200 ||
        typeof item.at !== "string" || !Number.isFinite(Date.parse(item.at))) throw new Error("invalid change");
    return { document: item.document, status: item.status, at: item.at, assignee: item.assignee };
  });
}

/** Read a portable review as its own table. Imported content is data and only known reason keys reach the UI. */
export function openReview(raw: string): { report: Report; changes: ReviewChange[] } {
  const envelope = JSON.parse(raw);
  const r = envelope?.report;
  const text = (value: unknown) => typeof value === "string" && value.length <= 4096;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
  const amount = (value: unknown) => text(value) && /^-?\d+(?:\.\d{1,12})?$/.test(value as string);
  const reasons = new Set(["reconcile.missingLeft", "reconcile.missingRight", "reconcile.different", "reconcile.multiple"]);
  if (!r || !text(r.company) || !text(r.period) || !count(r.leftCount) || !count(r.rightCount) ||
      !amount(r.left) || !amount(r.right) || !amount(r.difference) || !Array.isArray(r.exceptions) || r.exceptions.length > 100_000) throw new Error("invalid report");
  const seen = new Set<string>();
  for (const row of r.exceptions) {
    if (!row || !text(row.document) || seen.has(row.document) || !count(row.leftCount) || !count(row.rightCount) ||
        (row.left !== "" && !amount(row.left)) || (row.right !== "" && !amount(row.right)) || !amount(row.difference) ||
        !Array.isArray(row.reasons) || !row.reasons.length || row.reasons.length > reasons.size ||
        !row.reasons.every((reason: string) => reasons.has(reason))) throw new Error("invalid document");
    seen.add(row.document);
  }
  return { report: r, changes: changesFor(envelope, r) };
}
