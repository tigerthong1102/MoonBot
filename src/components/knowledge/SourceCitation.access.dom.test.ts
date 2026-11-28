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

it("rechecks access before restoring a citation after the tab becomes visible", async () => {
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
  await act(async () => revoke(new TypeError("suspended")));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  const proof = Promise.withResolvers<string | null>();
  vi.mocked(libraryKey).mockReturnValueOnce(proof.promise);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  await act(async () => proof.resolve(key));
  expect(document.body.textContent).toContain("Sensitive policy");
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.unmount());
});

it("hides a citation immediately on tab suspension and keeps it hidden when access was revoked", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = "a".repeat(64);
  const doc = { path: "secret.txt", digest, file: new File(["Sensitive policy"], "secret.txt"), passages: [{ page: 1, paragraph: 1, start: 0, text: "Sensitive policy" }] };
  vi.mocked(libraryKey).mockResolvedValue(key);
  vi.mocked(observeLibraryOwner).mockReturnValue(() => {});
  vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map([[doc.path, doc]]), changes: [] });
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  expect(document.body.textContent).toContain("Sensitive policy");
  hidden.mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  const proof = Promise.withResolvers<string | null>();
  vi.mocked(libraryKey).mockReturnValueOnce(proof.promise);
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  await act(async () => proof.resolve(null));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  await act(async () => root.unmount());
  hidden.mockRestore();
});

it("ignores an earlier pending citation load after the tab is hidden", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = "a".repeat(64);
  const doc = { path: "secret.txt", digest, file: new File(["Sensitive policy"], "secret.txt"), passages: [{ page: 1, paragraph: 1, start: 0, text: "Sensitive policy" }] };
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof currentLibrary>>>();
  vi.mocked(libraryKey).mockResolvedValue(key);
  vi.mocked(observeLibraryOwner).mockReturnValue(() => {});
  vi.mocked(currentLibrary).mockReturnValue(pending.promise);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  hidden.mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => pending.resolve({ docs: new Map([[doc.path, doc]]), changes: [] }));
  expect(document.body.textContent).not.toContain("Sensitive policy");
  await act(async () => root.unmount());
  hidden.mockRestore();
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

it("clears the access error when a source is successfully reselected after access returns", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = createHash("sha256").update("Sensitive policy").digest("hex");
  let revoke: (cause?: unknown) => void = () => {};
  vi.mocked(libraryKey).mockResolvedValue(key);
  vi.mocked(observeLibraryOwner).mockImplementation((_scope, unavailable) => { revoke = unavailable; return () => {}; });
  vi.mocked(currentLibrary).mockResolvedValue(undefined);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => revoke(new TypeError("offline")));
  expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["Sensitive policy"], "secret.txt")] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Sensitive policy"));
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.unmount());
});

it("watches the verified conversation after a manual retry from an initially unavailable scope", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = createHash("sha256").update("Sensitive policy").digest("hex");
  let scope: () => string | null = () => null;
  let revoke: (cause?: unknown) => void = () => {};
  vi.mocked(libraryKey).mockResolvedValueOnce(null).mockResolvedValue(key);
  vi.mocked(observeLibraryOwner).mockImplementation((getScope, unavailable) => { scope = getScope; revoke = unavailable; return () => {}; });
  vi.mocked(currentLibrary).mockResolvedValue(undefined);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  expect(scope()).toBeNull();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["Sensitive policy"], "secret.txt")] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Sensitive policy"));
  expect(scope()).toBe(key);
  await act(async () => revoke());
  expect(document.body.textContent).not.toContain("Sensitive policy");
  await act(async () => root.unmount());
});

it("ignores an old observer notification after the citation is reopened", async () => {
  const key = JSON.stringify(["viewer", "thread"]), digest = "a".repeat(64);
  const doc = { path: "secret.txt", digest, file: new File(["Sensitive policy"], "secret.txt"), passages: [{ page: 1, paragraph: 1, start: 0, text: "Sensitive policy" }] };
  let oldRevoke: (cause?: unknown) => void = () => {};
  vi.mocked(observeLibraryOwner).mockImplementationOnce((_scope, unavailable) => { oldRevoke = unavailable; return () => {}; }).mockReturnValue(() => {});
  vi.mocked(libraryKey).mockResolvedValue(key);
  vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map([[doc.path, doc]]), changes: [] });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(SourceCitation, { threadId: "thread", digest, start: 0 }, "[1]")));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>("dialog button")!.click());
  const proof = Promise.withResolvers<string | null>();
  vi.mocked(libraryKey).mockReturnValueOnce(proof.promise);
  await act(async () => host.querySelector("button")!.click());
  await act(async () => oldRevoke());
  await act(async () => proof.resolve(key));
  expect(document.body.textContent).toContain("Sensitive policy");
  await act(async () => root.unmount());
});
