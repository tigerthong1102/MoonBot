import { chmodSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { json, readBody } from "./harness/http.ts";
import { RoutineManager } from "./routines.ts";
import { zaloPeriodService } from "./routes/zalo-period-report.ts";
import { createZaloInbox } from "./zalo-inbox.ts";
import type { ZaloPeriodView } from "../shared/zalo-period-report.ts";

it("publishes one private period for Today through the real HTTP configuration and Routine tick, with zero bot turns", async () => {
  const home = mkdtempSync(join(tmpdir(), "zalo-period-host-"));
  const dir = join(home, ".startupbot-qualification", "zalo-official"); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "inbox.sqlite"), db = new DatabaseSync(file); chmodSync(file, 0o600);
  let time = Date.parse("2026-11-28T11:59:50Z");
  const service = zaloPeriodService(true, () => home, () => time);
  const startTurn = vi.fn(async () => { throw Error("unexpected agent dispatch"); });
  const manager = new RoutineManager({ file: join(home, "routines.json"), now: () => time, localReportSchedule: service,
    botState: () => "ready", createTask: () => { throw Error("unexpected task allocation"); }, startTurn });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    await service.route({ req, res, url, path: url.pathname, method: req.method!, auth: { kind: "loopback", scopes: ["admin"], desktopOwner: true }, json, readBody });
  });
  try {
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "fixture");
    for (const flag of ["STARTUPBOT_ZALO_OFFICIAL_PILOT", "STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "STARTUPBOT_ZALO_LOCAL_REPORTS"]) vi.stubEnv(flag, "1");
    const inbox = createZaloInbox(db, () => time);
    const scope = { accountId: "fixture", adapter: "official" as const, conversationId: "chat", conversationType: "direct" as const, senderId: "partner", retentionDays: 7 };
    const grant = inbox.enroll(scope);
    db.prepare("INSERT INTO zalo_webhook_endpoints VALUES(?,?,?,?)").run("endpoint", scope.accountId, Buffer.from("fixture"), grant);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw Error("port");
    const url = `http://127.0.0.1:${address.port}/api/zalo-official/reports`;
    const view = async () => (await (await fetch(url)).json() as { view: ZaloPeriodView | null }).view;
    const initial = (await view())!;
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: initial.revision, schedule: { cadence: "daily", hour: 19, minute: 0, timeZone: "Asia/Ho_Chi_Minh" } }) });
    expect(response.status).toBe(200);
    time += 5_000;
    inbox.accept({ ...scope, text: "Vui lòng báo giá gấp", direction: "incoming", messageId: "m", timestamp: time }, grant);
    expect(service.next()).toBe(Date.parse("2026-11-28T12:00:00Z"));
    time += 5_000;
    await manager.tick(); await manager.tick();
    expect((await view())!.periods).toHaveLength(1);
    expect((await view())!.periods[0]).toMatchObject({ count: 1, urgent: 1 });
    inbox.revoke(grant); time += 86_400_000; await manager.tick();
    expect(await view()).toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
  } finally { manager.close(); server.closeAllConnections(); server.close(); db.close(); rmSync(home, { recursive: true, force: true }); vi.unstubAllEnvs(); }
});
