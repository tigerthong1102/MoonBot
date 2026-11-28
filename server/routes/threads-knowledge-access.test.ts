import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it } from "vitest";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { Store } from "../store.ts";
import { createThreadRoutes, type ThreadRouteDeps } from "./threads.ts";

it("rechecks conversation visibility for each source-cache read without revealing hidden threads", async () => {
  const store = new Store(() => ({ instanceId: "fixture", model: "fixture" }));
  const bot = store.createBot({ name: "Fixture" });
  let allowed = true;
  const route = createThreadRoutes({ store, viewerFor: () => ({}), visibleTo: () => ({ thread: () => allowed }),
    workspaceAccess: () => null, desktopMutationToken: () => undefined, companionMutationToken: () => undefined,
    cliOwnerToken: () => undefined } as unknown as ThreadRouteDeps);
  const auth: RequestAuth = { kind: "session", via: "cookie", scopes: ["client"], session: {
    id: "viewer", label: "Viewer", email: "viewer@example.test", scopes: ["client"], tokenHash: "",
    createdAt: 0, lastSeenAt: 0, expiresAt: Infinity,
  } };
  async function get(thread: string, actor: RequestAuth = auth) {
    const path = `/api/threads/${thread}/knowledge-access`, req = new IncomingMessage(new Socket()), res = new ServerResponse(req);
    let status = 0, body: unknown;
    await route({ req, res, path, url: new URL(path, "http://localhost"), method: "GET", auth: actor,
      readBody: async () => ({}), json: (_res, code, data) => { status = code; body = data; } });
    return { status, body, cache: res.getHeader("cache-control") };
  }
  expect(requiredScope("GET", `/api/threads/${bot.threadId}/knowledge-access`)).toBe("client");
  expect(await get(bot.threadId)).toEqual({ status: 200, body: { owner: "viewer" }, cache: "private, no-store" });
  allowed = false;
  expect((await get(bot.threadId)).status).toBe(404);
  allowed = true;
  expect((await get("missing")).status).toBe(404);
  expect((await get(bot.threadId, { kind: "loopback", scopes: ["client"], trust: "service" })).status).toBe(404);
});
