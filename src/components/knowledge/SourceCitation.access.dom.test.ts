// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createHash } from "node:crypto";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { libraryKey } from "./source-cache";
import { currentLibrary, observeLibraryOwner } from "./source-sync";
import { SourceCitation } from "./SourceCitation";

vi.mock("./source-cache", () => ({ libraryKey: vi.fn() }));
vi.mock("./source-sync", () => ({ currentLibrary: vi.fn(), observeLibraryOwner: vi.fn(() => () => {}) }));
afterEach(() => { vi.resetAllMocks(); document.body.replaceChildren(); });

it("does not reveal a citation if conversation access is revoked while the document is loading", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = "a".repeat(64);
  vi.mocked(libraryKey).mockResolvedValueOnce(key).mockResolvedValueOnce(null);
  vi.mocked(observeLibraryOwner).mockReturnValue(() => {});
  const doc = { path: "secret.txt", digest, file: new File(["Sensitive policy"], "secret.txt"), passages: [{ page: 1, paragraph: 1, start: 0, text: "Sensitive policy" }] };
  vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map([[doc.path, doc]]), changes: [] });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  expect(document.body.textContent).not.toContain("Sensitive policy");
  expect(libraryKey).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it("does not show an old citation while a reopened dialog is waiting for fresh permission", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = "a".repeat(64);
  const doc = { path: "secret.txt", digest, file: new File(["Sensitive policy"], "secret.txt"), passages: [{ page: 1, paragraph: 1, start: 0, text: "Sensitive policy" }] };
  vi.mocked(libraryKey).mockResolvedValueOnce(key).mockResolvedValueOnce(key);
  vi.mocked(observeLibraryOwner).mockReturnValue(() => {});
  vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map([[doc.path, doc]]), changes: [] });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  expect(document.body.textContent).toContain("Sensitive policy");
  await act(async () => document.querySelector("dialog button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const proof = Promise.withResolvers<string | null>();
  vi.mocked(libraryKey).mockReturnValueOnce(proof.promise);
  await act(async () => host.querySelector("button")!.click());
  expect(document.body.textContent).not.toContain("Sensitive policy");
  await act(async () => proof.resolve(null));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  await act(async () => root.unmount());
});

it.each([new TypeError("offline"), new Error("server unavailable")])("withdraws an open citation if its access cannot be reverified", async (error) => {
  const key = JSON.stringify(["viewer", "thread"]), digest = "a".repeat(64);
  const doc = { path: "secret.txt", digest, file: new File(["Sensitive policy"], "secret.txt"), passages: [{ page: 1, paragraph: 1, start: 0, text: "Sensitive policy" }] };
  let revoke: (cause?: unknown) => void = () => {};
  vi.mocked(libraryKey).mockResolvedValue(key);
  vi.mocked(observeLibraryOwner).mockImplementation((_scope, unavailable) => { revoke = unavailable; return () => {}; });
  vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map([[doc.path, doc]]), changes: [] });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  expect(document.body.textContent).toContain("Sensitive policy");
  await act(async () => revoke(error));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => root.unmount());
});

it("does not restore a manually selected source after access is suspended during indexing", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = createHash("sha256").update("Sensitive policy").digest("hex");
  let revoke: (cause?: unknown) => void = () => {};
  vi.mocked(libraryKey).mockResolvedValue(key);
  vi.mocked(observeLibraryOwner).mockImplementation((_scope, unavailable) => { revoke = unavailable; return () => {}; });
  vi.mocked(currentLibrary).mockResolvedValue(undefined);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  const file = new File(["Sensitive policy"], "secret.txt"), read = Promise.withResolvers<ArrayBuffer>(), started = Promise.withResolvers<void>();
  Object.defineProperty(file, "arrayBuffer", { value: () => { started.resolve(); return read.promise; } });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await started.promise; });
  await act(async () => revoke(new TypeError("offline")));
  await act(async () => read.resolve(new TextEncoder().encode("Sensitive policy").buffer));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => root.unmount());
});
