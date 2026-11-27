import { afterEach, expect, it, vi } from "vitest";
import { fetchSourceLines } from "./source-line-reference";
const ref = { threadId: "my-thread", messageId: "m1", path: "invoice.csv", name: "invoice.csv", start: 2, end: 3, sha256: "a".repeat(64) };

afterEach(() => vi.unstubAllGlobals());
it("requests the pinned version from the originating conversation and rejects a changed response", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "0001,-42\n0002,99", sha256: ref.sha256 }) });
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchSourceLines(ref, ref.threadId)).toMatchObject({ text: "0001,-42\n0002,99" });
  expect(fetcher.mock.calls[0][0]).toBe("/api/threads/my-thread/messages/m1/file");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ path: "invoice.csv", sourceLines: { start: 2, end: 3, sha256: ref.sha256 } });
  await expect(fetchSourceLines(ref, "other")).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ text: "changed", sha256: "b".repeat(64) }) });
  await expect(fetchSourceLines(ref, ref.threadId)).rejects.toThrow();
});
it("keeps offline, revoked and renamed sources unavailable", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("offline"));
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchSourceLines(ref, ref.threadId)).rejects.toThrow("offline");
  for (const status of [403,404]) {
    fetcher.mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: "File unavailable" }) });
    await expect(fetchSourceLines(ref, ref.threadId)).rejects.toThrow("File unavailable");
  }
});
