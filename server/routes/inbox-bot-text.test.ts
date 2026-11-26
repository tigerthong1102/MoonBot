import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { SideJobs } from "../side-jobs.ts";

import { inboxBotTextRoutes } from "./inbox-bot-text.ts";
import { dispatchRoutes } from "./table.ts";

it("returns only registered unique usernames for eligible local bots", async () => {
  const username = `bot_k${"a".repeat(64)}`;
  const bots: Array<{ id: string; name: string; groupUsername?: string; hidden?: boolean }> = [{ id: "first", name: "Scout", groupUsername: username }, { id: "second", name: "Scout" }, { id: "hidden", name: "Hidden", hidden: true }, { id: "held", name: "Held" }, { id: "offline", name: "Offline" }];
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
    expect(await response.json()).toEqual({ bots: [{ id: "first", name: "Scout", username }, { id: "second", name: "Scout" }] });
    for (const id of ["hidden", "held"]) {
      const duplicate = bots.find(bot => bot.id === id)!;
      duplicate.groupUsername = username;
      const blocked = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/personal-inbox/bots`);
      expect(await blocked.json()).toEqual({ bots: [{ id: "first", name: "Scout" }, { id: "second", name: "Scout" }] });
      delete duplicate.groupUsername;
    }
    const denied = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/personal-inbox/bots`, { headers: { "x-fixture-service": "true" } });
    expect(denied.status).toBe(403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
