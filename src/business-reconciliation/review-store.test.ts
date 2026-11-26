import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Report } from "./report";
import type { ReviewChange } from "./review";
import { saveChanges } from "./review-store";

const { get, put, request } = vi.hoisted(() => {
  const request = { result: undefined, onsuccess: () => {} };
  return { get: vi.fn(() => request), put: vi.fn(), request };
});
vi.mock("../lib/browser-records", () => ({
  browserRecord: async (_mode: string, action: (store: unknown) => void) => {
    action({ get, put });
    request.onsuccess();
  },
}));

it("saves plain HTTP review changes under the existing SHA-256 key", async () => {
  const report: Report = { company: "Công ty", period: "2025", left: "0", right: "0", difference: "0", leftCount: 0, rightCount: 0, exceptions: [] };
  const changes: ReviewChange[] = [{ document: "01", status: "approved", assignee: "Lân", at: "2026-03-02T00:00:00Z" }];
  const hash = createHash("sha256").update(JSON.stringify(report)).digest("hex");

  vi.stubGlobal("crypto", {});
  try {
    expect(await saveChanges("owner", report, changes)).toEqual(changes);
    expect(get).toHaveBeenCalledWith(`review:owner:${hash}`);
    expect(put).toHaveBeenCalledWith({ report, changes }, `review:owner:${hash}`);
    expect(put).toHaveBeenCalledWith({ key: `review:owner:${hash}`, company: report.company, period: report.period, at: expect.any(Number) }, `review-list:owner:${hash}`);
  } finally {
    vi.unstubAllGlobals();
  }
});
