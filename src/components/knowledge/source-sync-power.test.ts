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
import { currentLibrary, watchDocumentSources } from "./source-sync";
import type { Index } from "./source-index";

vi.mock("@/lib/browser-records", () => ({ browserRecord: vi.fn() }));
const key = JSON.stringify(["viewer", "thread"]);
const folder = { kind: "cloud", name: "Drive", id: "folder" };
const auth = "/api/auth/session", list = "/api/sync/folders/folder/files", file = "/api/sync/folders/folder/file?path=policy.txt";
const records = new Map<string, unknown>();
let stop: (() => void) | undefined, tick: (() => void) | undefined;
const text = "Policy";
const sleep = () => Response.json({ error: "asleep" }, { status: 503, headers: { "x-omb-cloud-power": "asleep" } });
const calls: { path: string; background: string | null; activity: boolean }[] = [];
let answer: (path: string) => Response | Promise<Response>;

beforeEach(() => {
  calls.length = 0; records.clear(); stop = undefined; tick = undefined;
  records.set("watch:" + key, { id: "watch", key, source: folder });
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("IDBKeyRange", { bound: vi.fn() });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const intervals = vi.spyOn(window, "setInterval");
  tick = () => { const handler = intervals.mock.calls.find(([, delay]) => delay === 60_000)?.[0]; if (typeof handler === "function") handler(); };
  vi.mocked(browserRecord).mockImplementation(async (_mode, work) => {
    const store = {
      getAllKeys: () => ({ result: ["watch:" + key] }),
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
    return answer(path);
  }));
});
afterEach(() => { stop?.(); resetCloudPowerForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("marks the timer's ownership, manifest and byte reads as background, and leaves a manual refresh foreground", async () => {
  stop = watchDocumentSources();
  await vi.waitFor(() => expect((records.get(key) as Index)?.docs.has("Drive/policy.txt")).toBe(true));
  expect(calls).toEqual([auth, list, file].map(path => ({ path, background: "1", activity: false })));
  calls.length = 0;
  await currentLibrary(key);
  expect(calls.map(c => [c.path, c.background])).toEqual([[list, null], [file, null]]);
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
  expect(calls).toEqual([auth, list, auth].map(path => ({ path, background: "1", activity: false })));
});

it("retains a later scan's deletion even if an older scan of the same watch finishes last", async () => {
  await currentLibrary(key);
  const previous = answer, bytes = Promise.withResolvers<Response>(), waiting = Promise.withResolvers<void>();
  answer = path => { if (path !== file) return previous(path); waiting.resolve(); return bytes.promise; };
  const older = currentLibrary(key);
  await waiting.promise;
  answer = () => Response.json({ files: [] });
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
  answer = () => { requested.resolve(); return manifest.promise; };
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
  answer = path => path === list ? Response.json({ files: [{ path: "policy.txt", size: revised.length, sha256: "new" }] })
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
    await act(async () => { await vi.waitFor(() => expect(calls.filter(c => c.path === auth)).toHaveLength(3)); });
    expect(host.textContent).toContain(t("knowledge.indexed", { count: 1 }));
    const manual = calls.filter(c => c.path === auth || c.path === list || c.path === file);
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.every(c => c.background === null)).toBe(true);
    expect(manual.filter(c => c.path === auth).every(c => c.activity)).toBe(true);
    calls.length = 0;
    await act(async () => {
      stop = watchDocumentSources();
      await vi.waitFor(() => expect(calls.filter(c => c.path === auth)).toHaveLength(2));
    });
    expect(calls.map(c => [c.path, c.background, c.activity])).toEqual([auth, list, file, auth].map(path => [path, "1", false]));
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});
