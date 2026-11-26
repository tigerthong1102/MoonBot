import { browserRecord } from "../lib/browser-records";
import type { Report } from "./report";
import type { ReviewChange } from "./review";

export interface ReviewFile { report: Report; changes: ReviewChange[] }
export interface SavedReview { key: string; company: string; period: string; at: number }

export async function savedReviews(owner: string): Promise<SavedReview[]> {
  const prefix = "review-list:" + owner + ":";
  const list: SavedReview[] = await browserRecord("readonly", store => store.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff")));
  return list.sort((a, b) => b.at - a.at);
}

export function loadSavedReview(key: string): Promise<ReviewFile | undefined> {
  return browserRecord("readonly", store => store.get(key));
}

export async function saveChanges(owner: string, report: Report, changes: ReviewChange[]): Promise<ReviewChange[]> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(report)));
  const hash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  const id = owner + ":" + hash;
  const key = "review:" + id;
  let merged: ReviewChange[] = [];
  await browserRecord("readwrite", store => {
    const request = store.get(key);
    request.onsuccess = () => {
      merged = [...(request.result as ReviewFile | undefined)?.changes ?? []];
      const identity = (change: ReviewChange) => JSON.stringify([change.at, change.document, change.assignee, change.status]);
      const seen = new Set(merged.map(identity));
      for (const change of changes) {
        const signature = identity(change);
        if (!seen.has(signature)) { merged.push(change); seen.add(signature); }
      }
      store.put({ report, changes: merged } satisfies ReviewFile, key);
      store.put({ key, company: report.company, period: report.period, at: Date.now() } satisfies SavedReview, "review-list:" + id);
    };
    return request;
  });
  return merged;
}
