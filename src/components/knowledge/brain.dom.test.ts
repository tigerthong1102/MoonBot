// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserRecord } from "@/lib/browser-records";
import { api } from "@/state/api";
import { libraryOwner } from "./source-cache";
import { currentLibrary } from "./source-sync";
import { t } from "@/lib/i18n";
import {
  approvePage,
  evidenceReader,
  newPage,
  pageHistory,
  searchPages,
  verifiedPages,
  type BrainPage,
  type BrainSelection,
} from "./brain";
import BrainDialog from "./BrainDialog";
import type { Index } from "./source-index";

vi.mock("@/lib/browser-records", () => ({ browserRecord: vi.fn() }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: [] }, dispatch: vi.fn() }) }));
vi.mock("@/state/api", () => ({ api: vi.fn() }));
vi.mock("./source-cache", async (load) => ({
  ...(await load<typeof import("./source-cache")>()),
  libraryOwner: vi.fn(),
  libraryKey: vi.fn(async () => JSON.stringify(["viewer-a","thread"])),
}));
vi.mock("./source-sync", () => ({ currentLibrary: vi.fn(), observeLibraryOwner: () => () => {} }));
const pages = new Map<string, BrainPage>(),
  owner = "viewer-a",
  threadId = "thread",
  path = "Bien-ban.md",
  digest = "a".repeat(64);
const doc: BrainSelection = { kind: "document", threadId, path, digest, start: 0 };
const signal = () => new AbortController().signal;
const index = (text = "Khách Minh hẹn đối chiếu 15/12."): Index => ({
  changes: [],
  docs: new Map([
    [path, { path, digest, file: new File([text], path), passages: [{ start: 0, page: 1, paragraph: 1, text }] }],
  ]),
});
beforeEach(() => {
  vi.clearAllMocks();
  pages.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("IDBKeyRange", { bound: (lo: unknown[]) => lo });
  vi.mocked(browserRecord).mockImplementation(async (_mode, work) => {
    const store = {
      openCursor: ([, who, id]: string[]) => {
        const latest = [...pages.values()].filter(p => p.owner === who && p.id === id).sort((a, b) => b.version - a.version)[0];
        return { result: latest && { value: latest } };
      },
      getAll: ([, who]: string[]) => ({ result: [...pages.values()].filter((p) => p.owner === who) }),
      add: (page: BrainPage, key: unknown[]) => {
        const id = JSON.stringify(key);
        if (pages.has(id)) throw Error("duplicate");
        pages.set(id, structuredClone(page));
        return { result: key };
      },
    };
    const request = work(store as unknown as IDBObjectStore);
    request.onsuccess?.call(request, new Event("success"));
    return request.result;
  });
  vi.mocked(libraryOwner).mockResolvedValue(owner);
  vi.mocked(api).mockResolvedValue({ messages: [] });
  vi.mocked(currentLibrary).mockResolvedValue(index());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function draft() {
  const evidence = await evidenceReader(owner, signal())(doc);
  return newPage(owner, evidence!);
}
it("requires an explicit review, leaves no record on cancel, and reopens a source-backed page", async () => {
  vi.mocked(currentLibrary).mockImplementation(async (key, options) => {
    window.dispatchEvent(new CustomEvent("startupbot-document-sync", { detail: { key, signal: options?.signal } }));
    return index();
  });
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => button.click());
  };
  try {
    const open = async (key: string, selection?: BrainSelection) => {
      await act(async () => root.render(createElement(BrainDialog, { key, threadId, selection })));
    };
    await open("draft", doc);
    expect(host.querySelector("textarea")?.value).toContain("15/12");
    expect(pages.size).toBe(0);
    await click(t("common.cancel"));
    expect(pages.size).toBe(0);
    await open("approved", doc);
    await click(t("brain.approve"));
    expect(pages.size).toBe(1);
    await open("new session");
    expect(host.querySelector("article")?.textContent).toContain("15/12");
    expect(host.querySelector("article summary")?.textContent).toContain(path);
    await click(t("brain.openSource"));
    const sourceViewer = document.body.querySelector("dialog");
    expect(sourceViewer?.textContent).toContain("15/12");
    await act(async () => sourceViewer!.querySelector("button")!.click());
    await act(async () => window.dispatchEvent(new CustomEvent("startupbot-document-sync", { detail: {background:true} })));
    expect(vi.mocked(api).mock.lastCall?.[1]).toMatchObject({background:true});
    expect(vi.mocked(currentLibrary).mock.lastCall?.[1]).toMatchObject({background:true});
    await click(t("brain.export"));
    expect(download).toHaveBeenCalledOnce();
    vi.mocked(api).mockRejectedValue(Error("forbidden"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(host.textContent).not.toContain("15/12");
    expect(host.textContent).not.toContain(path);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("rechecks the viewer and exact file revision before persisting, and filters a revoked or deleted source", async () => {
  const proposal = await draft();
  vi.mocked(libraryOwner).mockResolvedValueOnce("viewer-b");
  await expect(approvePage(proposal, signal())).rejects.toThrow();
  vi.mocked(currentLibrary).mockResolvedValueOnce({ changes: [], docs: new Map() });
  await expect(approvePage(proposal, signal())).rejects.toThrow();
  expect(pages.size).toBe(0);
  await approvePage(proposal, signal());
  expect(await pageHistory("viewer-b")).toHaveLength(0);
  const newer = index("Changed meeting time");
  newer.docs.get(path)!.digest = "b".repeat(64);
  vi.mocked(currentLibrary).mockResolvedValue(newer);
  expect(await verifiedPages(owner, signal())).toHaveLength(0);
});
it("does not retrieve a saved AI answer after a cited primary source is withdrawn", async () => {
  const text = "Đối chiếu 15/12. [1](#startupbot-source-" + digest + "-0/" + path + ")";
  vi.mocked(api).mockResolvedValue({
    messages: [{ id: "message", kind: "text", role: "bot", text, at: 1 }],
    activeLeafId: "message",
  });
  const evidence = await evidenceReader(owner, signal())({ kind: "message", threadId, messageId: "message" });
  expect(evidence?.citations[0]?.quote).toContain("15/12");
  await approvePage(newPage(owner, evidence!), signal());
  vi.mocked(currentLibrary).mockResolvedValue({ changes: [], docs: new Map() });
  expect(await verifiedPages(owner, signal())).toEqual([]);
});
it("keeps separate IDs for identical customer names, preserves revisions, and rejects competing edits", async () => {
  const p = await draft();
  const one = await approvePage({ ...p, title: "Khách Minh" }, signal());
  const two = await approvePage({ ...(await draft()), title: "Khách Minh" }, signal());
  expect(one.id).not.toBe(two.id);
  const writes = await Promise.allSettled([
    approvePage({ ...one, body: "First edit" }, signal()),
    approvePage({ ...one, body: "Concurrent edit" }, signal()),
  ]);
  expect(writes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await pageHistory(owner)).toHaveLength(3);
  const matches = searchPages(await verifiedPages(owner, signal()), "Khach Minh hen doi chieu ngay nao?");
  expect(matches).toHaveLength(2);
  expect(new Set(matches.map((p) => p.page.id)).size).toBe(2);
});
it("does not approve after a chat edit or retrieve when a message is deleted", async () => {
  const message = { id: "m", kind: "text" as const, role: "user" as const, at: 1, text: "30 days" };
  vi.mocked(api).mockResolvedValue({ messages: [message], activeLeafId: "m" });
  const e = await evidenceReader(owner, signal())({ kind: "message", threadId, messageId: "m" });
  const p = newPage(owner, e!);
  vi.mocked(api).mockResolvedValueOnce({ messages: [{ ...message, text: "45 days" }], activeLeafId: "m" });
  await expect(approvePage(p, signal())).rejects.toThrow();
  await approvePage(p, signal());
  vi.mocked(api).mockResolvedValue({ messages: [], activeLeafId: null });
  expect(await verifiedPages(owner, signal())).toEqual([]);
});

it("keeps the private shelf open across an owner recheck and hides evidence while the recheck is pending", async () => {
  vi.stubGlobal("ogb", {remoteClient: {active: false}});
  vi.mocked(libraryOwner).mockResolvedValue("local");
  const item = { sourceId:"m", grantId:"g", quote:"Source visible only while allowed", timestamp:Date.now(),
    expires:Date.now()+60_000, conversationId:"chat", senderId:"sender", saved:true, revision:"rev" };
  let allowed = true;
  vi.mocked(api).mockImplementation(async path => String(path).includes("capability") ? {enabled:true} : {items:allowed ? [item] : []});
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const toggle = () => [...host.querySelectorAll("button")].find(b => b.textContent === t("zaloKnowledgeShelf.title"));
  try {
    await act(async () => root.render(createElement(BrainDialog, {threadId})));
    await act(async () => toggle()!.click());
    expect(host.textContent).toContain(item.quote);
    let finish!: (owner:string) => void;
    vi.mocked(libraryOwner).mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.textContent).not.toContain(item.quote);
    allowed = false;
    await act(async () => finish("local"));
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).not.toContain(item.quote);
  } finally {await act(async () => root.unmount()); host.remove();}
});

it("clears the view and cancels its pending read on a deletion notice while the Cloud sleeps", async () => {
  const { markCloudAsleep, resetCloudPowerForTests } = await import("@/lib/cloud-power");
  let notify: () => void = () => { throw new Error("missing tab listener"); };
  class Channel {
    set onmessage(listener: () => void) { notify = listener; }
    close() {}
    postMessage() {}
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const saved = await approvePage(await draft(), signal());
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(BrainDialog, { threadId })));
    expect(host.textContent).toContain(saved.title);
    const pending = Promise.withResolvers<Index>();
    vi.mocked(currentLibrary).mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    const during = vi.mocked(currentLibrary).mock.lastCall?.[1]?.signal;
    expect(during?.aborted).toBe(false);
    markCloudAsleep();
    const checks = vi.mocked(libraryOwner).mock.calls.length;
    await act(async () => notify());
    expect(during?.aborted).toBe(true);
    expect(libraryOwner).toHaveBeenCalledTimes(checks);
    await act(async () => pending.resolve(index()));
    expect(host.textContent).not.toContain(saved.title);
  } finally {
    resetCloudPowerForTests();
    await act(async () => root.unmount()); host.remove();
  }
});
