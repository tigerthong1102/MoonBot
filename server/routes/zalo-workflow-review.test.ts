import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import type { SavedWorkflow } from "../../shared/skill-burger/saved.ts";
import type { RequestAuth } from "../request-auth.ts";
import { json, readBody } from "../harness/http.ts";
import { createZaloWorkflowReviewRoutes } from "./zalo-workflow-review.ts";

const owner: RequestAuth = { kind: "loopback", scopes: ["admin"], desktopOwner: true };
const workflow: SavedWorkflow = { name: "accounting", summary: "Check totals", sha256: "abc", botId: "a", savedAt: "now", layers: [{ kind: "ai", label: "Review" }], args: ["month"], everyChat: false };

async function check(local: boolean, auth: RequestAuth, method = "GET") {
  const list = vi.fn(() => [workflow, { ...workflow, botId: "b", name: "private" }, { ...workflow, everyChat: true, name: "shared" }]);
  const route = createZaloWorkflowReviewRoutes(local, list);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    await route({ req, res, url, path: url.pathname, method: req.method!, auth, readBody, json });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing fixture port");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/zalo-workflow-review/a`, { method });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json(), list };
  } finally { server.closeAllConnections(); server.close(); }
}
it("reads only this bot's private saved workflow previews for the desktop owner", async () => {
  const result = await check(true, owner);
  expect(result.status).toBe(200);
  expect(result.cache).toBe("no-store");
  expect(result.list).toHaveBeenCalledWith("a");
  expect(result.body).toEqual({ workflows: [{ name: "accounting", summary: "Check totals", sha256: "abc", steps: ["Review"], inputs: ["month"] }] });
});
it("rejects hosted, unattended loopback, companion, service and mutation requests before reading the catalog", async () => {
  for (const [local, auth, method, expected] of [
    [false, owner, "GET", 403], [true, { ...owner, desktopOwner: false }, "GET", 403],
    [true, { ...owner, companionDevice: "phone" }, "GET", 403],
    [true, { ...owner, trust: "service" }, "GET", 403], [true, owner, "POST", 405],
  ] as const) {
    const result = await check(local, auth as RequestAuth, method);
    expect(result.status).toBe(expected);
    expect(result.list).not.toHaveBeenCalled();
  }
});
