// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import SourceLibrary from "./SourceLibrary";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { countsAsActivity } from "../../../server/cloud-power";
import { cloudAsleep, markCloudAsleep, resetCloudPowerForTests } from "@/lib/cloud-power";
import { sessionCheck } from "@/lib/session-ended";
import { browserRecord } from "@/lib/browser-records";
import { libraryKey } from "./source-cache";
import { sourceAnswerIssue } from "./source-answer-issue";
import { currentLibrary, watchDocumentSources } from "./source-sync";
import type { Index } from "./source-index";

vi.mock("@/lib/browser-records", () => ({ browserRecord: vi.fn() }));
const key = JSON.stringify(["viewer", "thread"]);
const folder = { kind: "cloud", name: "Drive", id: "folder" };
const auth = "/api/auth/session", list = "/api/sync/folders/folder/files", file = "/api/sync/folders/folder/file?path=policy.txt";
const access = "/api/threads/thread/knowledge-access";
const records = new Map<string, unknown>();
let stop: (() => void) | undefined, tick: (() => void) | undefined;
const text = "Policy";
const sleep = () => Response.json({ error: "asleep" }, { status: 503, headers: { "x-omb-cloud-power": "asleep" } });
const calls: { path: string; background: string | null; activity: boolean }[] = [];
let answer: (path: string) => Response | Promise<Response>;
let identity: string | null;
let conversationVisible: boolean;
let accessFailure: "network" | "503" | "legacy" | null;

beforeEach(() => {
  calls.length = 0; records.clear(); stop = undefined; tick = undefined;
  identity = null;
  conversationVisible = true;
  accessFailure = null;
  records.set("watch:" + key, { id: "watch", key, source: folder });
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("IDBKeyRange", { bound: vi.fn() });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const intervals = vi.spyOn(window, "setInterval");
  tick = () => { const handler = intervals.mock.calls.find(([, delay]) => delay === 60_000)?.[0]; if (typeof handler === "function") handler(); };
  vi.mocked(browserRecord).mockClear().mockImplementation(async (_mode, work) => {
    const store = {
      getAllKeys: () => ({ result: [...records.keys()].filter(id => id.startsWith("watch:")) }),
      get: (id: string) => ({ result: records.get(id) }),
      put: (value: unknown, id: string) => { records.set(id, value); return { result: id }; },
    };
    const request = work(store as unknown as IDBObjectStore);
    request.onsuccess?.call(request, new Event("success"));
    return request.result;
  });
  answer = path => {
    if (path === auth) return Response.json({ kind: "session", id: "viewer" });
    if (path === list) return Response.json({ files: [{ path: "policy.txt", size: text.length, sha256: "changed" }] });
    if (path === file) return new Response(text, { headers: { "content-length": String(text.length) } });
    throw new Error(path);
  };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input), headers = new Headers(init?.headers);
    calls.push({ path, background: headers.get("x-omb-background"), activity: countsAsActivity(path, Object.fromEntries(headers.entries())) });
    if (path === access) {
      if (accessFailure === "network") throw new TypeError("offline");
      if (accessFailure === "503") return Response.json({ error: "unavailable" }, { status: 503 });
      if (accessFailure === "legacy") return Response.json({ error: "not found" }, { status: 404 });
      return identity && conversationVisible ? Response.json({ owner: identity }) : Response.json({ error: "no such conversation", code: "knowledge_thread_unavailable" }, { status: 404 });
    }
    const result = await answer(path);
    if (path === auth) {
      const body = await result.clone().json().catch(() => ({}));
      identity = result.ok ? body.kind === "session" ? body.id : "local" : null;
    }
    return result;
  }));
});

it("stops opening and refreshing a saved library when conversation access is revoked without signing out", async () => {
  stop = watchDocumentSources();
  await vi.waitFor(() => expect((records.get(key) as Index)?.docs.size).toBe(1));
  expect(await libraryKey("thread")).toBe(key);
  calls.length = 0;
  conversationVisible = false;
  expect(await libraryKey("thread")).toBeNull();
  tick?.();
  await vi.waitFor(() => expect(calls.some(c => c.path === access && c.background === "1")).toBe(true));
  expect(calls.some(c => c.path === list || c.path === file)).toBe(false);
});

it("fails closed with an upgrade hint when an older server lacks the access proof", async () => {
  accessFailure = "legacy";
  await expect(libraryKey("thread")).resolves.toBeNull();
  await expect(libraryKey("thread", { reportOffline: true }).catch(sourceAnswerIssue)).resolves.toBe("knowledge.accessVerificationUnavailable");
});

it("does not commit or notify a scan when conversation access is revoked while source bytes are in flight", async () => {
  await currentLibrary(key);
  const before = records.get(key);
  const previous = answer, bytes = Promise.withResolvers<Response>(), waiting = Promise.withResolvers<void>();
  answer = path => { if (path !== file) return previous(path); waiting.resolve(); return bytes.promise; };
  const notify = vi.fn(); window.addEventListener("startupbot-document-sync", notify);
  try {
    const pending = currentLibrary(key); await waiting.promise;
    conversationVisible = false;
    bytes.resolve(await previous(file));
    expect(await pending).toBeUndefined();
    expect(records.get(key)).toBe(before);
    expect(notify).not.toHaveBeenCalled();
  } finally { window.removeEventListener("startupbot-document-sync", notify); }
});

it("withdraws an open library when conversation access is revoked in the same session", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "bot", threadId: "thread" } as Bot, open: true, close: () => {} })));
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain(t("knowledge.indexed", { count: 1 })); });
    calls.length = 0;
    await act(async () => {
      stop = watchDocumentSources();
      await vi.waitFor(() => expect(calls.some(c => c.path === list)).toBe(true));
      await vi.waitFor(() => expect((records.get("watch:" + key) as { scanId?: string }).scanId).toBeUndefined());
    });
    calls.length = 0;
    conversationVisible = false;
    await act(async () => { tick?.(); });
    await vi.waitFor(() => expect(host.textContent).toContain(t("knowledge.answerAccess")));
    expect(host.textContent).not.toContain("Drive/policy.txt");
    expect(calls.some(c => c.path === access)).toBe(true);
    expect(calls.some(c => c.path === list || c.path === file)).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(["auth-network", "access-network", "access-503"] as const)("withdraws the open library when %s prevents revalidation", async (failure) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "bot", threadId: "thread" } as Bot, open: true, close: () => {} })));
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain(t("knowledge.indexed", { count: 1 })); });
    calls.length = 0;
    await act(async () => {
      stop = watchDocumentSources();
      await vi.waitFor(() => expect(calls.some(c => c.path === list)).toBe(true));
      await vi.waitFor(() => expect((records.get("watch:" + key) as { scanId?: string }).scanId).toBeUndefined());
    });
    const previous = answer;
    if (failure === "auth-network") answer = path => { if (path === auth) throw new TypeError("offline"); return previous(path); };
    else accessFailure = failure === "access-503" ? "503" : "network";
    await act(async () => { tick?.(); });
    await vi.waitFor(() => expect(host.textContent).toContain(t("knowledge.answerNetwork")));
    expect(host.textContent).not.toContain("Drive/policy.txt");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(["hidden", "sleep"] as const)("withdraws the open library when the page becomes %s", async (mode) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "bot", threadId: "thread" } as Bot, open: true, close: () => {} })));
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain(t("knowledge.indexed", { count: 1 })); });
    await act(async () => { stop = watchDocumentSources(); });
    await act(async () => {
      if (mode === "sleep") markCloudAsleep();
      else { vi.spyOn(document, "hidden", "get").mockReturnValue(true); expect(document.hidden).toBe(true); document.dispatchEvent(new Event("visibilitychange")); }
    });
    expect(host.textContent).not.toContain("Drive/policy.txt");
    expect(host.textContent).toContain(t("knowledge.answerNetwork"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
afterEach(() => { stop?.(); resetCloudPowerForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("marks the timer's ownership, manifest and byte reads as background, and leaves a manual refresh foreground", async () => {
  stop = watchDocumentSources();
  await vi.waitFor(() => expect((records.get(key) as Index)?.docs.has("Drive/policy.txt")).toBe(true));
  expect(calls).toEqual([auth, auth, access, auth, access, list, file, auth, access].map(path => ({ path, background: "1", activity: false })));
  calls.length = 0;
  await currentLibrary(key);
  expect(calls.map(c => [c.path, c.background])).toEqual([auth, access, auth, access, list, file, auth, access].map(path => [path, null]));
});

it.each([auth, list, file])("leaves the saved index intact when the Cloud falls asleep on %s", async refused => {
  const path = "Drive/policy.txt";
  const cache: Index = { docs: new Map([[path, { path, digest: "old", file: new File(["retained"], path),
    passages: [{ start: 0, page: 1, paragraph: 1, text: "retained" }] }]]), changes: [] };
  records.set(key, cache);
  const awake = answer; answer = path => path === refused ? sleep() : awake(path);
  stop = watchDocumentSources();
  await vi.waitFor(() => expect(cloudAsleep()).toBe(true));
  expect(records.get(key)).toBe(cache);
  const sent = calls.length;
  tick?.(); await Promise.resolve();
  expect(calls).toHaveLength(sent);
  expect(calls.every(c => c.background === "1" && !c.activity)).toBe(true);
});

it("never contacts a sleeping Cloud and keeps the session recheck after a genuine denial in the background", async () => {
  markCloudAsleep(); stop = watchDocumentSources();
  expect(calls).toEqual([]);
  resetCloudPowerForTests();
  const awake = answer; answer = path => path === list ? Response.json({ error: "permission denied" }, { status: 403 }) : awake(path);
  tick?.();
  await vi.waitFor(() => expect((records.get(key) as Index)?.changes.at(-1)?.issue).toBe("signedOut"));
  await sessionCheck();
  expect(calls.map(c => c.path).sort()).toEqual([auth, auth, access, auth, access, list, auth, access, auth].sort());
  expect(calls.every(c => c.background === "1" && !c.activity)).toBe(true);
});

it("retains a later scan's deletion even if an older scan of the same watch finishes last", async () => {
  await currentLibrary(key);
  const previous = answer, bytes = Promise.withResolvers<Response>(), waiting = Promise.withResolvers<void>();
  answer = path => { if (path !== file) return previous(path); waiting.resolve(); return bytes.promise; };
  const older = currentLibrary(key);
  await waiting.promise;
  answer = path => path === auth ? previous(path) : Response.json({ files: [] });
  const newer = await currentLibrary(key);
  expect(newer?.docs.size).toBe(0);
  bytes.resolve(await previous(file)); await older;
  expect((records.get(key) as Index).docs.size).toBe(0);
  expect((records.get(key) as Index).changes.at(-1)?.state).toBe("removed");
});

it("withholds the previous cache from a superseded scan while a newer scan still verifies access", async () => {
  await currentLibrary(key);
  const previous = answer, bytes = Promise.withResolvers<Response>(), waiting = Promise.withResolvers<void>();
  answer = path => { if (path !== file) return previous(path); waiting.resolve(); return bytes.promise; };
  const older = currentLibrary(key); await waiting.promise;
  const manifest = Promise.withResolvers<Response>(), requested = Promise.withResolvers<void>();
  answer = path => { if (path === auth) return previous(path); requested.resolve(); return manifest.promise; };
  const newer = currentLibrary(key); await requested.promise;
  bytes.resolve(await previous(file));
  expect((await older)?.docs.size ?? 0).toBe(0);
  manifest.resolve(Response.json({ files: [] })); await newer;
});

it("returns the newer verified edition to a superseded scan after that edition commits", async () => {
  const previous = answer, bytes = Promise.withResolvers<Response>(), started = Promise.withResolvers<void>();
  answer = path => { if (path !== file) return previous(path); started.resolve(); return bytes.promise; };
  const older = currentLibrary(key); await started.promise;
  const revised = "Updated edition";
  answer = path => path === auth ? previous(path) : path === list ? Response.json({ files: [{ path: "policy.txt", size: revised.length, sha256: "new" }] })
    : new Response(revised, { headers: { "content-length": String(revised.length) } });
  const newer = await currentLibrary(key);
  bytes.resolve(await previous(file));
  const restored = await older;
  expect(restored?.docs.get("Drive/policy.txt")?.passages[0]?.text).toBe(revised);
  expect(restored?.changes).toEqual(newer?.changes);
});

it("distinguishes an unreachable session check from a signed-out document reader", async () => {
  answer = () => { throw new TypeError("offline"); };
  await expect(libraryKey("thread", { reportOffline: true })).rejects.toThrow(TypeError);
  expect(await libraryKey("thread")).toBeNull();
  answer = () => Response.json({ error: "signed out" }, { status: 401 });
  expect(await libraryKey("thread", { reportOffline: true })).toBeNull();
});

it("keeps the open dialog's timer-driven ownership recheck in the background while explicit reads are foreground", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), bot = { id: "bot", threadId: "thread" } as Bot;
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot, open: true, close: () => {} })));
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain(t("knowledge.indexed", { count: 1 })); });
    expect(host.textContent).toContain(t("knowledge.indexed", { count: 1 }));
    const manual = calls.filter(c => c.path === auth || c.path === list || c.path === file);
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.every(c => c.background === null)).toBe(true);
    expect(manual.filter(c => c.path === auth).every(c => c.activity)).toBe(true);
    calls.length = 0;
    await act(async () => {
      stop = watchDocumentSources();
      await vi.waitFor(() => expect(calls.some(c => c.path === file)).toBe(true));
    });
    expect(calls.some(c => c.path === access)).toBe(true);
    expect(calls.every(c => c.background === "1" && !c.activity)).toBe(true);
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});

it.each([
  ["watch", "signed out"], ["watch", "another reader"], ["manual", "signed out"], ["manual", "another reader"],
  ["memory", "signed out"], ["memory", "another reader"],
] as const)("withdraws the open %s document when the watch timer finds %s before scanning", async (storage, session) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const path = storage === "watch" ? "Drive/policy.txt" : "policy.txt";
  const file = new File([text], "policy.txt");
  if (storage !== "watch") records.delete("watch:" + key);
  if (storage === "manual") records.set(key, { docs: new Map([[path, { path, file, digest: "a".repeat(64),
    passages: [{ page: 1, paragraph: 1, start: 0, text }] }]]), changes: [] } satisfies Index);
  if (storage === "memory") {
    vi.stubGlobal("indexedDB", undefined);
    vi.mocked(browserRecord).mockRejectedValue(new Error("No storage"));
  }
  stop = watchDocumentSources();
  if (storage === "watch") await vi.waitFor(() => expect((records.get(key) as Index)?.docs.size).toBe(1));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "b", threadId: "thread" } as Bot, open: true, close: () => {} })));
    if (storage === "watch") await act(async () => { await vi.waitFor(() => expect(calls.filter(c => c.path === auth).length).toBeGreaterThanOrEqual(3)); });
    if (storage === "memory") {
      const picker = host.querySelector<HTMLInputElement>("input[type=file]")!;
      Object.defineProperty(picker, "files", { value: [file] });
      await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { await vi.waitFor(() => expect(vi.mocked(browserRecord).mock.calls.some(([mode]) => mode === "readwrite")).toBe(true)); });
    }
    const search = host.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "policy");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const hit = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(path))!;
    await act(async () => hit.click());
    expect(host.querySelector("dialog section")?.textContent).toContain(text);
    calls.length = 0;
    answer = route => {
      if (route !== auth) throw new Error("Unexpected source read: " + route);
      return session === "signed out" ? Response.json({}, { status: 401 }) : Response.json({ kind: "session", id: "next-reader" });
    };
    await act(async () => { tick?.(); });
    expect(host.textContent).not.toContain(path);
    expect(host.querySelector("dialog section")).toBeNull();
    expect(search.value).toBe("");
    expect(host.textContent).toContain(t("knowledge.answerAccess"));
    expect(calls).toEqual([{ path: auth, background: "1", activity: false }]);
  } finally { await act(async () => root.unmount()); host.remove(); }
  if (storage !== "watch") {
    calls.length = 0; tick?.(); await Promise.resolve();
    expect(calls).toEqual([]);
  }
});

it.each([
  ["workspace_backup_busy", "knowledge.answerMaintenance"],
  ["workspace_restore_restart", "knowledge.answerRestoreRestart"],
] as const)("keeps the library private and shows the specific %s recovery on open and focus", async (code, issue) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  records.delete("watch:" + key);
  const path = "private-policy.txt", content = "Confidential policy contents.";
  records.set(key, { docs: new Map([[path, { path, file: new File([content], path), digest: "a".repeat(64),
    passages: [{ page: 1, paragraph: 1, text: content, start: 0 }] }]]), changes: [] } satisfies Index);
  const denied = () => Response.json({ code }, { status: 503 }), session = () => Response.json({ kind: "session", id: "viewer" });
  let ownership: () => Response | Promise<Response> = denied;
  answer = route => route === auth ? ownership() : Response.json({});
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), focus = () => act(async () => { window.dispatchEvent(new Event("focus")); });
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "b", threadId: "thread" } as Bot, open: true, close: () => {} })));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t(issue));
    expect(browserRecord).not.toHaveBeenCalled();
    let verified = false;
    ownership = () => { if (verified) return denied(); verified = true; return session(); };
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === t("chat.retry"))!.click());
    expect(browserRecord).toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t(issue));
    expect(host.textContent).not.toContain(path);
    expect(host.textContent).not.toContain(content);
    ownership = session; await focus();
    const search = host.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "policy");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const passage = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(path))!;
    await act(async () => passage.click());
    expect(host.querySelector("dialog section")?.textContent).toContain(content);
    ownership = denied;
    calls.length = 0;
    await act(async () => { stop = watchDocumentSources(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t(issue));
    expect(host.textContent).not.toContain(content);
    expect(calls).toEqual([{ path: auth, background: "1", activity: false }]);
    ownership = session; await focus(); await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(path))!.click());
    const delayed = Promise.withResolvers<Response>();
    ownership = () => delayed.promise; await focus();
    expect(host.textContent).not.toContain(path);
    expect(host.textContent).not.toContain(content);
    await act(async () => delayed.resolve(denied()));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t(issue));
    ownership = () => Response.json({ error: "unauthenticated" }, { status: 401 });
    calls.length = 0;
    vi.stubGlobal("indexedDB", undefined);
    await act(async () => { tick?.(); });
    expect(calls).toEqual([{ path: auth, background: "1", activity: false }]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("knowledge.answerAccess"));
    expect(search.value).toBe("");
    expect(host.textContent).not.toContain(content);
    ownership = session; await focus();
    expect(search.value).toBe("");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(["same reader", "reader switch", "switch back"] as const)("discards older cloud picker completions for %s", async scenario => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); records.clear();
  let owner = "viewer", enumerations = 0;
  const first = Promise.withResolvers<Response>();
  const folders = (cloudPath: string) => Response.json({ folders: [{ id: "folder", cloudPath }] });
  answer = path => {
    if (path === auth) return Response.json({ kind: "session", id: owner });
    if (path === "/api/sync") return ++enumerations === 1 ? first.promise : folders("Latest selection");
    return Response.json({ capabilities: { cloudHome: true } });
  };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), bot = { id: "b", threadId: "thread" } as Bot;
  const change = async (id: string) => { owner = id; await act(async () => { window.dispatchEvent(new Event("focus")); }); };
  const pick = async () => act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === t("knowledge.cloudFolders"))!.click());
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot, open: true, close: () => {} })));
    await pick();
    if (scenario !== "same reader") await change("other");
    if (scenario === "switch back") await change("viewer");
    await pick();
    expect(host.textContent).toContain("Latest selection");
    await act(async () => first.resolve(folders("Original reader private folder")));
    expect(host.textContent).not.toContain("Original reader private folder");
    expect(host.textContent).toContain("Latest selection");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("forgets a RAM-only document as well as its draft on a 401 while a maintenance check is suspended", async () => {
  records.clear(); vi.stubGlobal("indexedDB", undefined); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(browserRecord).mockRejectedValue(new Error("no IndexedDB"));
  let status = 200;
  answer = path => path === auth ? Response.json(status === 200 ? { kind: "session", id: "viewer" } : { code: "workspace_backup_busy" }, { status }) : Response.json({});
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), focus = () => act(async () => { window.dispatchEvent(new Event("focus")); });
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "b", threadId: "thread" } as Bot, open: true, close: () => {} })));
    const file = host.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(file, "files", { value: [new File(["Private policy"], "volatile.txt")] });
    await act(async () => { file.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await vi.waitFor(() => expect(vi.mocked(browserRecord).mock.calls.some(([mode]) => mode === "readwrite")).toBe(true)); });
    const search = host.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "policy");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("Private policy");
    status = 503; await focus();
    await act(async () => { stop = watchDocumentSources(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("knowledge.answerMaintenance"));
    status = 401; calls.length = 0;
    await act(async () => { tick?.(); });
    expect(calls).toEqual([{ path: auth, background: "1", activity: false }]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("knowledge.answerAccess"));
    status = 200; await focus();
    expect(search.value).toBe("");
    expect(host.textContent).toContain(t("knowledge.indexed", { count: 0 }));
    expect(host.textContent).not.toContain("volatile.txt");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(["timer", "focus"])("resumes the same reader's watched library on the first successful scan after %s detects maintenance", async trigger => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const normal = answer, maintenance = () => Response.json({ code: "workspace_backup_busy" }, { status: 503 });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "b", threadId: "thread" } as Bot, open: true, close: () => {} })));
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain(t("knowledge.indexed", { count: 1 })); });
    const search = host.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "policy");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("Drive/policy.txt");
    answer = maintenance;
    if (trigger === "focus") await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { stop = watchDocumentSources(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("knowledge.answerMaintenance"));
    expect(host.textContent).not.toContain("Drive/policy.txt");
    calls.length = 0;
    const content = "Updated policy after maintenance";
    answer = path => path === list ? Response.json({ files: [{ path: "policy.txt", size: content.length, sha256: "new-edition" }] })
      : path === file ? new Response(content, { headers: { "content-length": String(content.length) } }) : normal(path);
    await act(async () => { tick?.(); await vi.waitFor(() => expect((records.get(key) as Index).docs.get("Drive/policy.txt")?.passages[0]?.text).toBe(content)); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(search.value).toBe("policy");
    expect(host.textContent).toContain(content);
    expect(calls.filter(c => c.path === list || c.path === file).map(c => c.path)).toEqual([list, file]);
    expect(calls.every(c => c.background === "1" && !c.activity)).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
