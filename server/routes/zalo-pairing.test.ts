import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { json, parsedBodyOf, readBody } from "../harness/http.ts";
import type { ZaloPairingStatus } from "../../shared/zalo-pairing.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createZaloWebhookPilot } from "../zalo-webhook.ts";
import { createZaloPairingRoutes } from "./zalo-pairing.ts";

const owner: RequestAuth = { kind: "loopback", scopes: ["admin"], desktopOwner: true };
let home: string;
const cleanup: (() => Promise<void> | void)[] = [];
beforeEach(() => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "fixture-bot");
  home = mkdtempSync(join(tmpdir(), "zalo-pair-"));
});
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
async function snapshot(response: Response | Promise<Response>) {
  return (await (await response).json()) as ZaloPairingStatus & { command: string };
}
function provision() {
  const dir = join(home, ".startupbot-qualification", "zalo-official");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "inbox.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  cleanup.push(() => db.close());
  const pilot = createZaloWebhookPilot(db);
  const bot = pilot.register("fixture-bot");
  return { pilot, bot, db };
}
async function serve(auth = owner, local = true, fixture?: ReturnType<typeof provision>) {
  const route = createZaloPairingRoutes(local, () => home);
  const captured: unknown[] = [];
  const app = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    if (fixture && await fixture.pilot.door(req, res, url)) return;
    await route({ req, res, url, path: url.pathname, method: req.method!, auth, readBody, json });
    captured.push(parsedBodyOf(req));
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  cleanup.push(() => new Promise<void>(r => app.close(() => r())));
  const address = app.address();
  if (!address || typeof address === "string") throw Error();
  const origin = "http://127.0.0.1:" + address.port;
  const path = origin + "/api/zalo-official/pairing";
  let serial = 0;
  return { captured, get: () => fetch(path), post: (body: object) => fetch(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), deliver: (text: string) => fetch(origin + fixture!.bot.path, { method: "POST", headers: {
    "content-type": "application/json", "x-bot-api-secret-token": fixture!.bot.secret,
  }, body: JSON.stringify({ event_name: "message.text.received", message: { message_id: "fixture-" + ++serial, date: Date.now() + 1,
    from: { id: "participant", is_bot: false }, chat: { id: "private-chat", chat_type: "PRIVATE" }, text } }) }) };
}

it("smokes owner actions through loopback HTTP and reads committed data from a separate SQLite connection", async () => {
  const fixture = provision();
  const f = await serve(owner, true, fixture);
  const other = fixture.pilot.register("unrelated");
  const ready = await snapshot(f.get());
  expect(ready).toMatchObject({ state: "ready", accountId: "fixture-bot" });
  const issued = await f.post({ action: "invite", revision: ready.revision });
  expect(issued.headers.get("cache-control")).toBe("no-store");
  const waiting = await snapshot(issued);
  expect(waiting.command).toMatch(/^\/pair [a-zA-Z0-9_-]{22}$/);
  expect(await snapshot(f.get())).not.toHaveProperty("command");
  expect((await f.deliver(waiting.command)).status).toBe(204);
  const candidate = await snapshot(f.get());
  expect(candidate).toMatchObject({ state: "candidate", participant: { senderId: "participant", conversationId: "private-chat" } });
  const approve = { action: "approve", revision: candidate.revision, ...candidate.participant, retentionDays: 3 };
  expect((await f.post({ ...approve, senderId: "other" })).status).toBe(409);
  expect((await f.post({ ...approve, conversationId: "elsewhere" })).status).toBe(409);
  expect((await f.post({ ...approve, retentionDays: 366 })).status).toBe(400);
  expect((await f.post({ ...approve, revision: waiting.revision })).status).toBe(409);
  const grant = await snapshot(f.post(approve));
  expect(grant).toMatchObject({ state: "paired", retentionDays: 3, coverage: { count: 0 } });
  expect((await f.post(approve)).status).toBe(409);
  expect((await f.deliver("private fixture message")).status).toBe(204);
  const scoped = await snapshot(f.get());
  expect(scoped.coverage).toMatchObject({ count: 1, first: expect.any(Number), last: expect.any(Number) });
  expect(JSON.stringify(scoped)).not.toContain("private fixture message");
  expect(JSON.stringify(scoped)).not.toContain(fixture.bot.secret);
  expect(JSON.stringify(scoped)).not.toContain(fixture.bot.endpoint);
  fixture.db.prepare("UPDATE zalo_events SET expires=?").run(Date.now() - 1);
  fixture.pilot.purgeExpired();
  expect((await snapshot(f.get())).coverage?.count).toBe(0);
  expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM zalo_events").get()?.n).toBe(0);
  expect((await f.deliver("retained until revocation")).status).toBe(204);
  expect((await f.post({ action: "revoke", revision: grant.revision })).status).toBe(200);
  expect((await f.deliver("revoked")).status).toBe(403);
  expect(await snapshot(f.get())).toEqual({ state: "unconfigured" });
  expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM zalo_events").get()?.n).toBe(0);
  expect(fixture.pilot.inspect("unrelated")?.endpoint).toBe(other.endpoint);
  expect(JSON.stringify(f.captured)).not.toContain("participant");
});

it("refuses untrusted callers and disabled flags before opening, creating or inspecting an inbox", async () => {
  for (const [local, auth] of [[false, owner], [true, { ...owner, desktopOwner: false }], [true, { ...owner, trust: "service" }],
    [true, { ...owner, companionDevice: "paired" }], [true, { ...owner, kind: "session" }]] as [boolean, RequestAuth][]) {
    const f = await serve(auth, local);
    expect((await f.get()).status).toBe(403);
    expect((await f.post({ action: "revoke" })).status).toBe(403);
  }
  const f = await serve();
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "");
  expect((await f.get()).status).toBe(403);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "");
  expect((await f.post({ action: "invite" })).status).toBe(403);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  expect(await snapshot(f.get())).toEqual({ state: "unconfigured" });
  expect(existsSync(join(home, ".startupbot-qualification"))).toBe(false);
});

it("expires pending consent, rejects a stale revoke after re-provisioning and isolates the configured account", async () => {
  const fixture = provision();
  const f = await serve(owner, true, fixture);
  const prior = await snapshot(f.get());
  const waiting = await snapshot(f.post({ action: "invite", revision: prior.revision }));
  await f.deliver(waiting.command);
  const old = await snapshot(f.get());
  fixture.db.prepare("UPDATE zalo_pair_challenges SET expires=?").run(Date.now() - 1);
  expect((await f.post({ action: "approve", revision: old.revision, ...old.participant, retentionDays: 1 })).status).toBe(409);
  expect((await snapshot(f.get())).state).toBe("ready");
  fixture.pilot.remove(fixture.bot.endpoint);
  fixture.pilot.register("fixture-bot");
  expect((await f.post({ action: "revoke", revision: prior.revision })).status).toBe(409);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "elsewhere");
  expect(await snapshot(f.get())).toEqual({ state: "unconfigured" });
});
