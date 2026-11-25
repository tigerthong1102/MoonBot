import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { SideJobs } from "../side-jobs.ts";
import { botUsername } from "../../shared/bot-username.ts";
import { inboxBotTextRoutes } from "./inbox-bot-text.ts";
import { dispatchRoutes } from "./table.ts";

it("returns distinct stable usernames for eligible local bots with identical names", async () => {
  const bots = [{ id: "first", name: "Scout" }, { id: "second", name: "Scout" }, { id: "hidden", name: "Hidden", hidden: true }, { id: "held", name: "Held" }, { id: "offline", name: "Offline" }];
  const routes = [inboxBotTextRoutes({ desktop: true, bots: () => bots, held: id => id === "held", jobs: { text: (_kind: string, id: string) => id === "offline" ? undefined : {} } as unknown as SideJobs })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const auth = req.headers["x-fixture-service"] ? { kind: "loopback" as const, trust: "service" as const, scopes: ["client" as const] } : { kind: "loopback" as const, scopes: ["admin" as const] };
    await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/personal-inbox/bots`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bots: bots.slice(0, 2).map(bot => ({ ...bot, username: botUsername(bot.id) })) });
    const denied = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/personal-inbox/bots`, { headers: { "x-fixture-service": "true" } });
    expect(denied.status).toBe(403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
