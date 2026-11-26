import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { SideJobs } from "../side-jobs.ts";
import { inboxBotTextRoutes } from "./inbox-bot-text.ts";
import { dispatchRoutes } from "./table.ts";

it("anchors only an eligible bot in the same workspace through the desktop route", async () => {
  let workspaceId = "11111111-1111-4111-8111-111111111111", saved = 0;
  const bots = [{ id: "fixture", name: "Fixture" }];
  const routes = [inboxBotTextRoutes({ desktop: true, bots: () => bots, held: () => false, jobs: {} as SideJobs,
    workspaceId: () => workspaceId, identityOwner: req => req.headers["x-fixture-native"] === "trusted" && !req.headers.origin, saveIdentity: (_id, expected) => { if (expected !== workspaceId) return false; saved++; return true; } })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const auth = req.headers["x-fixture-service"] ? { kind: "loopback" as const, trust: "service" as const, scopes: ["client" as const] } : { kind: "loopback" as const, scopes: ["admin" as const] };
    await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/personal-inbox/bot-identity`;
    const input = { id: "fixture", workspaceId, username: `bot_k${"a".repeat(64)}`, publicKey: "b".repeat(64) };
    expect(await (await fetch(url)).json()).toEqual({ workspaceId });
    workspaceId = "22222222-2222-4222-8222-222222222222";
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-fixture-native": "trusted", ...headers }, body: JSON.stringify(body) });
    expect((await post(input)).status).toBe(409);
    expect(saved).toBe(0);
    expect((await post({ ...input, workspaceId }, { "x-fixture-service": "true" })).status).toBe(403);
    expect((await post({ ...input, workspaceId }, { origin: "http://127.0.0.1" })).status).toBe(403);
    expect((await post({ ...input, workspaceId, id: "missing" })).status).toBe(409);
    expect((await post({ ...input, workspaceId })).status).toBe(200);
    expect(saved).toBe(1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it("does not pass a discussion to a different workspace and keeps the matching workspace guarded", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  let writes = 0, held = 0;
  const routes = [inboxBotTextRoutes({ desktop: true, bots: () => [{ id: "fixture", name: "Fixture" }], held: () => false,
    acquireWorkspace: id => { if (id !== workspaceId) return null; held++; return () => { held--; }; },
    jobs: { text: () => ({ generateText: async () => { expect(held).toBe(1); writes++; return "fixture response"; } }) } as unknown as SideJobs })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin"] }, json, readBody });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/personal-inbox/bots`;
    const post = (id: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "fixture", workspaceId: id, topic: "fixture topic", prior: null, locale: "en" }) });
    expect((await post("22222222-2222-4222-8222-222222222222")).status).toBe(409);
    expect(writes).toBe(0);
    expect((await post(workspaceId)).status).toBe(200);
    expect(writes).toBe(1);
    expect(held).toBe(0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
