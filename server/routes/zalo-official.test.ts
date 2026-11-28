import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { json, parsedBodyOf, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { probeZaloOfficialToken } from "../zalo-official.ts";
import { createZaloOfficialRoutes } from "./zalo-official.ts";

afterEach(() => vi.unstubAllEnvs());
const owner: RequestAuth = { kind: "loopback", scopes: ["admin"], desktopOwner: true };

async function fixture(local: boolean, auth: RequestAuth, probe: typeof probeZaloOfficialToken) {
  const route = createZaloOfficialRoutes(local, probe);
  const observedBodies: unknown[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    await route({ req, res, url, path: url.pathname, method: req.method!, auth, readBody, json });
    observedBodies.push(parsedBodyOf(req));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing port");
  const endpoint = `http://127.0.0.1:${address.port}/api/zalo-official/probe`;
  return { observedBodies, get: () => fetch(endpoint), post: (payload: unknown, signal?: AbortSignal) => fetch(endpoint, {
    signal, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }), close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

it("requires both local managed desktop and the Electron owner's capability", async () => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  const probe = vi.fn<typeof probeZaloOfficialToken>();
  for (const [local, auth] of [
    [false, owner],
    [true, { kind: "loopback", scopes: ["admin"] }],
    [true, { kind: "loopback", scopes: ["admin"], trust: "service" }],
    [true, { kind: "loopback", scopes: ["admin"], companionDevice: "fixture" }],
    [true, { kind: "session", scopes: ["admin"] }],
  ] as [boolean, RequestAuth][]) {
    const f = await fixture(local, auth, probe);
    try {
      expect((await f.get()).status).toBe(403);
      expect((await f.post({ token: "123:fixture" })).status).toBe(403);
    } finally { await f.close(); }
  }
  expect(probe).not.toHaveBeenCalled();
});

it("checks feature availability and returns scoped identity despite unavailable webhook inspection", async () => {
  const calls: string[] = [];
  const probe: typeof probeZaloOfficialToken = (token, signal) => probeZaloOfficialToken(token, signal, async input => {
    const method = String(input).split("/").at(-1)!;
    calls.push(method);
    const reply = method === "getMe" ? { ok: true, result: { id: "provider-id", account_name: "bot.fixture" } } :
      { ok: false, error_code: 404, description: "private provider message " + token };
    return Response.json(reply);
  });
  const f = await fixture(true, owner, probe);
  try {
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "");
    expect(await (await f.get()).json()).toEqual({ enabled: false });
    expect((await f.post({ token: "123:fixture" })).status).toBe(403);
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
    expect(await (await f.get()).json()).toEqual({ enabled: true });
    expect((await f.post({ token: "123:fixture", url: "https://wrong.test" })).status).toBe(400);
    const response = await f.post({ token: "123:fixture" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ identityVerified: true, accountId: "provider-id", accountName: "bot.fixture",
      webhookConfigured: null, webhookError: "webhook-not-found" });
    expect(calls).toEqual(["getMe", "getWebhookInfo"]);
    expect(JSON.stringify(f.observedBodies)).not.toContain("123:fixture");
  } finally { await f.close(); }
});

it("stops after the first provider request when the operator closes the probe", async () => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  const methods: string[] = [];
  let began!: () => void;
  const firstCall = new Promise<void>(resolve => { began = resolve; });
  let done!: () => void;
  const settled = new Promise<void>(resolve => { done = resolve; });
  const probe: typeof probeZaloOfficialToken = async (token, signal) => {
    try {
      return await probeZaloOfficialToken(token, signal, async input => {
        methods.push(String(input).split("/").at(-1)!);
        began();
        if (!signal?.aborted) await new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }));
        return Response.json({ ok: true, result: { id: "provider-id" } });
      });
    } finally { done(); }
  };
  const f = await fixture(true, owner, probe);
  const controller = new AbortController();
  try {
    const sent = f.post({ token: "123:fixture" }, controller.signal).catch(() => undefined);
    await firstCall;
    controller.abort();
    await Promise.all([sent, settled]);
    expect(methods).toEqual(["getMe"]);
  } finally { await f.close(); }
});
