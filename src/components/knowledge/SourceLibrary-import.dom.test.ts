// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DataPanel } from "../data/DataPanel";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { api } from "@/state/api";
import { libraryKey, readLibrary } from "./source-cache";
import { currentLibrary, setSource } from "./source-sync";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { dataSheets: {}, dataTables: {}, connected: true }, dispatch }) }));
vi.mock("../data/SqlEditor", () => ({ SqlEditor: () => null }));
vi.mock("@/state/api", async load => ({ ...await load<typeof import("@/state/api")>(), api: vi.fn() }));
vi.mock("./source-cache", async load => ({ ...await load<typeof import("./source-cache")>(), libraryKey: vi.fn(), readLibrary: vi.fn() }));
vi.mock("./source-sync", async load => ({
  ...await load<typeof import("./source-sync")>(), currentLibrary: vi.fn(), readWatch: async () => null, setSource: vi.fn(),
}));

let root: Root, host: HTMLElement, owner: string;
const mount = async (threadId: string) => { await act(async () => root.render(createElement(DataPanel, { bot: { id: "bot", threadId } as Bot }))); };
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label);
const click = async (label: string) => { await act(async () => button(label)!.click()); };
const open = () => click(t("knowledge.title"));
const ask = () => click(t("knowledge.ask", { count: 1 }));
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>("input[type=search]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectFile(file: File) {
  const control = host.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(control, "files", { configurable: true, value: [file] });
  await act(async () => { control.dispatchEvent(new Event("change", { bubbles: true })); });
}
const doc = () => new File(["Manual ledger reference."], "Guide.txt");
const indexed = async () => { await act(async () => { await vi.waitFor(() => expect(setSource).toHaveBeenCalled()); }); };

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  owner = "reader";
  vi.mocked(libraryKey).mockImplementation(async thread => owner + "/" + thread);
  vi.mocked(currentLibrary).mockResolvedValue(undefined);
  vi.mocked(setSource).mockRejectedValue(new Error("IndexedDB unavailable"));
  vi.mocked(api).mockResolvedValue({ ok: true });
  await import("./SourceLibrary");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await mount("a"); await open();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it.each(["unavailable", "stale"])("answers from manually picked bytes while storage is %s, scoped to their viewer", async failure => {
  if (failure === "unavailable") vi.mocked(currentLibrary).mockRejectedValue(new Error("IndexedDB unavailable"));
  else vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map(), changes: [] });
  await selectFile(doc()); await indexed(); await search("ledger");
  expect(host.textContent).toContain(t("knowledge.cacheFailed"));
  vi.mocked(readLibrary).mockResolvedValue({ docs: new Map(), changes: [] });
  await act(async () => { window.dispatchEvent(new CustomEvent("startupbot-document-sync", { detail: "reader/a" })); });
  owner = "another reader"; await ask();
  expect(api).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Manual ledger reference.");
  expect(host.textContent).toContain(t("knowledge.answerAccess"));
  owner = "reader"; await click(t("reconcile.close")); await open(); await ask();
  expect(api).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(vi.mocked(api).mock.calls[0]![1]?.body))).toMatchObject({
    threadId: "a", question: "ledger", evidence: [{ path: "Guide.txt", text: "Manual ledger reference." }],
  });
  await open(); await click(t("knowledge.clear")); await search("ledger");
  expect(button(t("knowledge.ask", { count: 1 }))).toBeUndefined();
});

it("requires a new read for a picked folder whose watch could not be saved", async () => {
  let permitted = true;
  vi.stubGlobal("showDirectoryPicker", async () => ({
    name: "Watched", async *values() {
      if (!permitted) throw new Error("permission revoked");
      yield { kind: "file", name: "Guide.txt", getFile: async () => doc() };
    },
  }));
  await click(t("knowledge.folder")); await indexed(); await search("ledger");
  await ask();
  await act(async () => { await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1)); });
  permitted = false; await open();
  expect(host.textContent).not.toContain("Manual ledger reference.");
  expect(api).toHaveBeenCalledTimes(1);
  expect(button(t("knowledge.ask", { count: 1 }))).toBeUndefined();
});

it("unmounts the old library on a same-bot thread switch and discards an unfinished file import when reopening", async () => {
  await selectFile(doc()); await indexed(); await search("ledger");
  const stalled = new File(["private"], "unfinished.txt");
  const started = Promise.withResolvers<void>(), bytes = Promise.withResolvers<ArrayBuffer>();
  Object.defineProperty(stalled, "arrayBuffer", { value: () => { started.resolve(); return bytes.promise; } });
  await selectFile(stalled); await started.promise;
  await mount("b");
  expect(host.querySelector("dialog")).toBeNull();
  await open(); await search("ledger");
  expect(button(t("knowledge.ask", { count: 1 }))).toBeUndefined();
  await act(async () => bytes.resolve(new TextEncoder().encode("private").buffer));
  await mount("a"); await open(); await search("private");
  expect(button(t("knowledge.ask", { count: 1 }))).toBeUndefined();
  expect(vi.mocked(setSource).mock.calls.map(([scope]) => scope)).toEqual(["reader/a"]);
  expect(api).not.toHaveBeenCalled();
});

it("hides the previous excerpt throughout revalidation on reopening, including when access has expired", async () => {
  const path = "Policy.txt", text = "Private ledger threshold.";
  const stored = { docs: new Map([[path, { path, file: new File([text], path), digest: "a".repeat(64),
    passages: [{ page: 1, paragraph: 1, start: 0, text }] }]]), changes: [] };
  await click(t("reconcile.close"));
  vi.mocked(currentLibrary).mockResolvedValue(stored);
  await open(); await search("ledger");
  expect(host.textContent).toContain(text);
  await click(t("reconcile.close"));
  const next = Promise.withResolvers<typeof stored>();
  vi.mocked(currentLibrary).mockReturnValue(next.promise);
  await open();
  expect(host.textContent).not.toContain(text);
  expect(host.textContent).not.toContain(path);
  await act(async () => next.reject(new Error("access expired")));
  expect(host.textContent).not.toContain(text);
  expect(button(t("knowledge.ask", { count: 1 }))).toBeUndefined();
});

it("removes a previous reader's selected passage and results when the latest sync sees an expired session", async () => {
  const text = "Private ledger reference.", path = "Private.txt";
  const stored = { docs: new Map([[path, { path, file: new File([text], path), digest: "a".repeat(64),
    passages: [{ start: 0, page: 1, paragraph: 1, text }] }]]), changes: [] };
  await click(t("reconcile.close"));
  vi.mocked(currentLibrary).mockResolvedValue(stored);
  await open(); await search("ledger");
  const hit = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(path))!;
  await act(async () => hit.click());
  expect(host.querySelector("dialog section")?.textContent).toContain(text);
  vi.mocked(readLibrary).mockResolvedValue({ docs: new Map(), changes: [] });
  vi.mocked(libraryKey).mockResolvedValue(null);
  await act(async () => { window.dispatchEvent(new CustomEvent("startupbot-document-sync", { detail: "reader/a" })); });
  expect(host.textContent).not.toContain(path);
  expect(host.textContent).not.toContain(text);
  expect(button(t("knowledge.ask", { count: 1 }))).toBeUndefined();
  expect(host.textContent).toContain(t("knowledge.answerAccess"));
});

it("does not submit when the user switches conversations during the final ownership lookup", async () => {
  await selectFile(doc()); await indexed(); await search("ledger");
  const final = Promise.withResolvers<string>(), started = Promise.withResolvers<void>();
  vi.mocked(libraryKey).mockResolvedValueOnce("reader/a").mockImplementationOnce(() => { started.resolve(); return final.promise; });
  await ask(); await started.promise;
  await mount("b");
  await act(async () => final.resolve("reader/a"));
  expect(api).not.toHaveBeenCalled();
});

it("ignores an obsolete ownership check after a newer restore verified the current reader", async () => {
  const path = "Policy.txt", text = "Updated ledger passage.";
  const saved = { docs: new Map([[path, { path, digest: "c".repeat(64), file: new File([text], path),
    passages: [{ start: 0, page: 1, paragraph: 1, text }] }]]), changes: [] };
  vi.mocked(readLibrary).mockResolvedValue(saved);
  const previous = Promise.withResolvers<string | null>(), started = Promise.withResolvers<void>();
  vi.mocked(libraryKey).mockImplementationOnce(() => { started.resolve(); return previous.promise; });
  const notify = async () => { await act(async () => { window.dispatchEvent(new CustomEvent("startupbot-document-sync", { detail: "reader/a" })); }); };
  await notify(); await started.promise; await notify(); await search("ledger");
  expect(host.textContent).toContain(text);
  await act(async () => previous.resolve(null));
  expect(host.textContent).toContain(text);
  expect(host.textContent).not.toContain(t("knowledge.answerAccess"));
});
