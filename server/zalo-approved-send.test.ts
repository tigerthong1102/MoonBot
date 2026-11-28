import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createZaloReplyStore } from "./zalo-approved-send.ts";
import { createZaloInbox } from "./zalo-inbox.ts";
import { createZaloWebhookPilot } from "./zalo-webhook.ts";
import type { ZaloReplyPreview } from "../shared/zalo-approved-send.ts";

const token = "911:only-a-fixture";
const text = "Đã nhận mẫu thử.";
const clean: (() => void)[] = [];
afterEach(() => { vi.unstubAllEnvs(); while (clean.length) clean.pop()!(); });
const ok = (result: unknown) => Response.json({ ok: true, error_code: 0, result });
const signal = () => new AbortController().signal;
function from(p: ZaloReplyPreview) {
  return { actionId: p.actionId, digest: p.digest, grantId: p.source.grantId, sourceId: p.source.sourceId, text: p.text };
}
function fixture() {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  const dir = mkdtempSync(join(tmpdir(), "zalo-send-"));
  clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "fixture.sqlite");
  const db = new DatabaseSync(path);
  clean.push(() => db.close());
  let now = Date.now(), active = true;
  const accountId = "fixture-bot";
  const scope = { accountId, senderId: "fixture-person", conversationId: "fixture-chat", conversationType: "direct" as const, adapter: "official" as const };
  const pilot = createZaloWebhookPilot(db, () => now);
  const endpoint = pilot.register(accountId);
  const inbox = createZaloInbox(db, () => now);
  const grantId = inbox.enroll({ ...scope, retentionDays: 2 });
  db.prepare("UPDATE zalo_webhook_endpoints SET grantId=? WHERE endpoint=?").run(grantId, endpoint.endpoint);
  const record = (messageId: string) => inbox.accept({ ...scope, direction: "incoming", timestamp: ++now, messageId, text: "Nguồn tổng hợp" }, grantId);
  record("fixture-source");
  const store = createZaloReplyStore(db, accountId, () => active, () => now);
  const draft = () => store.preview({ grantId, sourceId: "fixture-source" }, text)!;
  return { db, path, store, draft, grantId, inbox, pilot, endpoint, record, setActive: () => { active = false; },
    later: () => { now += 300_001; }, now: () => now };
}
function transport(verify: () => Response | Promise<Response> = () => ok({ id: "fixture-bot" }),
  send: () => Response | Promise<Response> = () => ok({ message_id: "fixture-receipt" })) {
  const calls: string[] = [], sent: unknown[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://bot-api.zaloplatforms.com");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const method = url.pathname.split("/").at(-1)!;
    calls.push(method);
    if (method === "getMe") return verify();
    expect(method).toBe("sendMessage");
    sent.push(JSON.parse(String(init?.body)));
    return send();
  };
  return { request, calls, sent };
}

it("binds the visible text to one source and sends a single private message to exactly the paired chat", async () => {
  const f = fixture(), p = f.draft(), t = transport();
  expect(p).toMatchObject({ text, source: { accountId: "fixture-bot", senderId: "fixture-person", conversationId: "fixture-chat" } });
  const body = from(p);
  expect(await f.store.send(body, token, signal(), t.request)).toEqual({ status: "acknowledged", receiptId: "fixture-receipt" });
  expect(t.calls).toEqual(["getMe", "sendMessage"]);
  expect(t.sent).toEqual([{ chat_id: "fixture-chat", text }]);
  expect(f.store.source()).toMatchObject({ delivery: "acknowledged", receiptId: "fixture-receipt" });
  expect(await f.store.send(body, token, signal(), t.request)).toEqual({ status: "changed" });
  expect(f.draft()).toBeUndefined();
  f.inbox.eraseInterval(f.grantId, p.source.sourceTime, f.now());
  expect(f.store.source()).toBeUndefined();
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM zalo_reply_actions").get()?.n).toBe(0);
});

it("rejects modified approvals, invalid plain text, superseded previews, and expired authority without provider calls", async () => {
  const f = fixture(), p = f.draft(), t = transport(), body = from(p);
  for (const changed of [{ text: "other" }, { digest: "f".repeat(64) }, { actionId: "different" }, { grantId: "wrong" }, { sourceId: "wrong" }]) {
    expect(await f.store.send({ ...body, ...changed }, token, signal(), t.request)).toEqual({ status: "changed" });
  }
  for (const value of ["", " ", "test\u202ehello", "a".repeat(2001)]) expect(f.store.preview(body, value)).toBeUndefined();
  const newer = f.draft();
  expect(newer.actionId).not.toBe(p.actionId);
  expect(await f.store.send(body, token, signal(), t.request)).toEqual({ status: "changed" });
  f.later();
  expect(await f.store.send(from(newer), token, signal(), t.request)).toEqual({ status: "changed" });
  expect(t.calls).toEqual([]);
});

it.each(["erase", "revoke", "expire", "disable", "abort", "source-changed", "sender-changed"])("rechecks %s during identity verification", async scenario => {
  const f = fixture(), p = f.draft(), c = new AbortController();
  const t = transport(() => {
    if (scenario === "erase") f.inbox.eraseInterval(f.grantId, 0, f.now());
    if (scenario === "revoke") f.pilot.remove(f.endpoint.endpoint);
    if (scenario === "expire") f.later();
    if (scenario === "disable") f.setActive();
    if (scenario === "abort") c.abort();
    if (scenario === "source-changed") f.db.prepare("UPDATE zalo_events SET text=? WHERE grantId=?").run("different", f.grantId);
    if (scenario === "sender-changed") f.db.prepare("UPDATE zalo_grants SET senderId=? WHERE grantId=?").run("different", f.grantId);
    return ok({ id: "fixture-bot" });
  });
  expect((await f.store.send(from(p), token, c.signal, t.request)).status).not.toBe("acknowledged");
  expect(t.calls).toEqual(["getMe"]);
});

it.each([() => ok({ id: "different" }), () => Response.json({ ok: true, error_code: 100, result: { id: "fixture-bot" } }),
  () => Response.json({ ok: true, result: { id: "fixture-bot" } }, { status: 202 })])("refuses an unverified sender bot", async verify => {
  const f = fixture(), t = transport(verify);
  expect(await f.store.send(from(f.draft()), token, signal(), t.request)).toEqual({ status: "identity-failed" });
  expect(t.calls).toEqual(["getMe"]);
});

it.each([() => { throw Error("transport fixture"); }, () => ok({}), () => new Response(null, { status: 502 })])(
  "persists unknown before dispatch, keeping the account blocked across new source messages and independent runtimes", async reply => {
    const f = fixture(), p = f.draft();
    const observer = new DatabaseSync(f.path);
    clean.push(() => observer.close());
    const second = createZaloReplyStore(observer, "fixture-bot", () => true, f.now);
    const t = transport(undefined, () => {
      expect(second.source()).toMatchObject({ delivery: "unknown", accountHeld: true });
      return reply();
    });
    expect(await f.store.send(from(p), token, signal(), t.request)).toEqual({ status: "unknown" });
    expect(await second.send(from(p), token, signal(), t.request)).toEqual({ status: "changed" });
    f.record("next-source");
    expect(second.source()).toMatchObject({ accountHeld: true, sourceId: "next-source" });
    expect(second.preview({ grantId: f.grantId, sourceId: "next-source" }, "new")).toBeUndefined();
    expect(t.sent).toHaveLength(1);
  },
);

it("allows just one of two concurrent approvals to dispatch and removes grant-specific receipts on revocation", async () => {
  const f = fixture(), p = f.draft(), t = transport();
  const statuses = await Promise.all([f.store.send(from(p), token, signal(), t.request), f.store.send(from(p), token, signal(), t.request)]);
  expect(statuses.map(x => x.status).sort()).toEqual(["acknowledged", "changed"]);
  expect(t.sent).toHaveLength(1);
  f.pilot.remove(f.endpoint.endpoint);
  expect(f.store.source()).toBeUndefined();
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM zalo_reply_actions").get()?.n).toBe(0);
});

it("returns no participant or receipt after revocation while the provider handles a reserved request", async () => {
  const f = fixture(), p = f.draft();
  const t = transport(undefined, () => { f.pilot.remove(f.endpoint.endpoint); return ok({ message_id: "fixture-receipt" }); });
  expect(await f.store.send(from(p), token, signal(), t.request)).toEqual({ status: "changed" });
  expect(t.sent).toHaveLength(1);
});
