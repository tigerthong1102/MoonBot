// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { countsAsActivity } from "../../../server/cloud-power";
import { cloudAsleep, markCloudAsleep, resetCloudPowerForTests } from "@/lib/cloud-power";
import { sessionCheck } from "@/lib/session-ended";
import { browserRecord } from "@/lib/browser-records";
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
let answer: (path: string) => Response;

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
