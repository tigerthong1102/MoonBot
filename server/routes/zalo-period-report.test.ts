import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { zaloPeriodService } from "./zalo-period-report.ts";
afterEach(() => vi.unstubAllEnvs());
const owner: RequestAuth = { kind: "loopback", scopes: ["admin"], desktopOwner: true };
async function request(local: boolean, auth: RequestAuth, method = "GET", body?: object) {
  const service = zaloPeriodService(local, () => "/fixture-does-not-exist");
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    await service.route({ path: url.pathname, url, req, res, method: req.method!, json, auth, readBody });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("No fixture port");
  try {
    const response = await fetch(`http://127.0.0.1:${addr.port}/api/zalo-official/reports`, { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
    return { status: response.status, raw: await response.json() };
  } finally { server.closeAllConnections(); server.close(); }
}
it("requires both pilot flags, the report flag, desktop owner and a valid timezone, even on the regular HTTP path", async () => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1"); vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1"); vi.stubEnv("STARTUPBOT_ZALO_LOCAL_REPORTS", "0");
  expect((await request(true, owner)).status).toBe(403);
  vi.stubEnv("STARTUPBOT_ZALO_LOCAL_REPORTS", "1"); vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "fixture");
  expect((await request(false, owner)).status).toBe(403);
  expect((await request(true, { ...owner, desktopOwner: false })).status).toBe(403);
  expect((await request(true, { ...owner, trust: "service" })).status).toBe(403);
  expect(await request(true, owner)).toEqual({ status: 200, raw: { view: null } });
  expect((await request(true, owner, "POST", { revision: "a".repeat(64), schedule: { cadence: "daily", hour: 17, minute: 0, timeZone: "Wrong/Place" } })).status).toBe(400);
  expect((await request(true, owner, "POST", { revision: "a".repeat(64), schedule: null })).status).toBe(409);
});
