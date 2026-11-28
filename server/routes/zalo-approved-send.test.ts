import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import type { ZaloReplyPreview } from "../../shared/zalo-approved-send.ts";
import { json, parsedBodyOf, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createZaloInbox } from "../zalo-inbox.ts";
import { createZaloWebhookPilot } from "../zalo-webhook.ts";
import { createZaloReplyRoutes } from "./zalo-approved-send.ts";

afterEach(() => vi.unstubAllEnvs());

it("smokes real owner HTTP preview/approve/status with synthetic transport, refusing other principals and scrubbing request-body observers", async () => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "fixture-actor");
  for (const key of ["PILOT", "WEBHOOK_PILOT", "APPROVED_SEND_PILOT"]) vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_" + key, "1");
  const home = mkdtempSync(join(tmpdir(), "zalo-approve-route-"));
  const folder = join(home, ".startupbot-qualification", "zalo-official");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, "inbox.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  const scope = { adapter: "official", accountId: "fixture-actor", senderId: "fixture-person", conversationId: "fixture-private", conversationType: "direct" } as const;
  const pilot = createZaloWebhookPilot(db);
  const endpoint = pilot.register(scope.accountId);
  const inbox = createZaloInbox(db);
  const grantId = inbox.enroll({ ...scope, retentionDays: 1 });
  db.prepare("UPDATE zalo_webhook_endpoints SET grantId=? WHERE endpoint=?").run(grantId, endpoint.endpoint);
  inbox.accept({ ...scope, timestamp: Date.now(), direction: "incoming", messageId: "fixture-source", text: "fixture incoming" }, grantId);
  const requests: string[] = [];
  const transport: typeof fetch = async input => {
    const method = new URL(String(input)).pathname.split("/").at(-1)!;
    requests.push(method);
    return Response.json({ ok: true, result: method === "getMe" ? { id: scope.accountId } : { message_id: "fixture-receipt" } });
  };
  const owner: RequestAuth = { kind: "loopback", scopes: ["admin"], desktopOwner: true };
  let auth = owner, local = true;
  const observed: unknown[] = [];
  const app = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    await createZaloReplyRoutes(local, () => home, transport)({ req, res, url, path: url.pathname, method: req.method!, auth, readBody, json });
    observed.push(parsedBodyOf(req));
  });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const address = app.address();
  if (!address || typeof address === "string") throw Error();
  const url = "http://127.0.0.1:" + address.port + "/api/zalo-official/reply";
  const call = (body?: object) => fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const token = "833:synthetic-pilot-token";
  const text = "synthetic owner-only approved body";
  const common = { grantId, sourceId: "fixture-source", text };
  try {
    for (const attempt of [{ ...owner, desktopOwner: false }, { ...owner, companionDevice: "fixture" }, { ...owner, trust: "service" as const },
      { ...owner, kind: "session" as const }]) {
      auth = attempt;
      expect((await call()).status).toBe(403);
      expect((await call({ token, action: "send" })).status).toBe(403);
    }
    auth = owner; local = false;
    expect((await call()).status).toBe(403);
    local = true;
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_APPROVED_SEND_PILOT", "");
    expect((await call()).status).toBe(403);
    vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_APPROVED_SEND_PILOT", "1");
    expect((await call({ action: "preview", ...common, chat_id: "arbitrary" })).status).toBe(400);
    expect(await (await call()).json()).toMatchObject({ source: { accountId: scope.accountId, sourceId: common.sourceId } });
    const res = await call({ action: "preview", ...common });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const p = await res.json() as ZaloReplyPreview;
    const send = { action: "send", token, actionId: p.actionId, digest: p.digest, ...common };
    expect((await call(send)).status).toBe(400);
    expect(requests).toEqual([]);
    expect(await (await call({ ...send, approvedByOwner: true })).json()).toMatchObject({ status: "acknowledged", receiptId: "fixture-receipt" });
    expect(await (await call({ ...send, approvedByOwner: true })).json()).toEqual({ status: "changed" });
    expect(await (await call()).json()).toMatchObject({ source: { delivery: "acknowledged", receiptId: "fixture-receipt" } });
    expect(requests).toEqual(["getMe", "sendMessage"]);
    const stored = readFileSync(file);
    for (const sensitive of [token, text]) {
      expect(JSON.stringify(observed)).not.toContain(sensitive);
      expect(stored.includes(Buffer.from(sensitive))).toBe(false);
    }
  } finally {
    await new Promise<void>(r => app.close(() => r())); db.close(); rmSync(home, { recursive: true, force: true });
  }
});
