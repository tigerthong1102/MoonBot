import { afterEach, expect, it, vi } from "vitest";
import { browserRecord } from "./browser-records";

afterEach(() => vi.unstubAllGlobals());

it.each(["complete", "abort"])("settles a successful request only after the transaction reports %s", async outcome => {
  const request = { result: "saved", onsuccess: () => {} };
  const store = { get: () => request };
  const transaction = { objectStore: () => store, oncomplete: () => {}, onabort: () => {}, error: new Error("aborted") };
  const db = { transaction: () => transaction, close: vi.fn() };
  const opening = { result: db, onsuccess: () => {} };
  vi.stubGlobal("indexedDB", { open: () => opening });
  let settled = false;
  const result = browserRecord("readonly", records => records.get("key")).finally(() => { settled = true; });
  opening.onsuccess(); await Promise.resolve(); request.onsuccess(); await Promise.resolve();
  expect(settled).toBe(false);
  expect(db.close).not.toHaveBeenCalled();
  if (outcome === "complete") { transaction.oncomplete(); await expect(result).resolves.toBe("saved"); }
  else { transaction.onabort(); await expect(result).rejects.toThrow("aborted"); }
  expect(db.close).toHaveBeenCalledOnce();
});
