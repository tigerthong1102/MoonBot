import { afterEach, expect, it, vi } from "vitest";
import { browserRecord } from "@/lib/browser-records";
import { forgetBrainPages } from "./brain-erasure";

vi.mock("@/lib/browser-records", () => ({ browserRecord: vi.fn(async () => []) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
const session = { kind: "session", id: "my-session", scopes: ["client"], environmentId: "env", label: "Browser", expiresAt: 1000, via: "cookie" };
const loopback = { kind: "loopback", scopes: ["admin", "client"], environmentId: "env" };
it.each([
  ["empty object", "local", {}], ["missing fields", "local", { kind: "loopback" }],
  ["service", "local", { ...loopback, trust: "service" }], ["unknown trust", "local", { ...loopback, trust: "unknown" }],
  ["unknown kind", "local", { ...loopback, kind: "unknown" }], ["local scope", "local", { ...loopback, scopes: ["client"] }],
  ["wrong owner", "another-session", session], ["reserved identity", "local", { ...session, id: "local" }],
  ["missing session fields", "my-session", { ...session, via: undefined }],
] as const)("refuses erasure before accessing storage for %s", async (_case, owner, reply) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(reply)));
  await expect(forgetBrainPages(owner, null, new AbortController().signal)).rejects.toThrow();
  expect(browserRecord).not.toHaveBeenCalled();
});
it("refuses a successful HTML response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Log in</html>")));
  await expect(forgetBrainPages("local", null, new AbortController().signal)).rejects.toThrow();
  expect(browserRecord).not.toHaveBeenCalled();
});
it.each([["local", loopback], ["my-session", session]] as const)("checks a fresh explicit identity for %s", async (owner, reply) => {
  vi.stubGlobal("window", {});
  const fetcher = vi.fn(async () => Response.json(reply));
  vi.stubGlobal("fetch", fetcher);
  await forgetBrainPages(owner, null, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ credentials: "same-origin", cache: "no-store", redirect: "error" }));
  expect(browserRecord).toHaveBeenCalledOnce();
});
