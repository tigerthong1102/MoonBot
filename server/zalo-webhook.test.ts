import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createZaloInbox } from "./zalo-inbox.ts";
import { createZaloWebhookPilot } from "./zalo-webhook.ts";
import { listenWebhookIngress, type WebhookIngress } from "./webhook-ingress.ts";
import { WebhookManager } from "./webhooks.ts";

let time: number, serial: number, directory: string;
let db: DatabaseSync, observer: DatabaseSync;
let inbox: ReturnType<typeof createZaloInbox>, pilot: ReturnType<typeof createZaloWebhookPilot>;
let server: WebhookIngress, bot: ReturnType<typeof pilot.register>;
const enqueue = vi.fn(() => ({ id: "unused" }));
beforeEach(async () => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  directory = mkdtempSync(join(tmpdir(), "zalo-webhook-"));
  const path = join(directory, "fixture.sqlite");
  db = new DatabaseSync(path);
  observer = new DatabaseSync(path);
  time = Date.now(); serial = 0; enqueue.mockClear();
  pilot = createZaloWebhookPilot(db, () => time);
  inbox = createZaloInbox(observer, () => time);
  bot = pilot.register("fixture-bot");
  server = await listenWebhookIngress(new WebhookManager({ file: join(directory, "hooks.json"), enqueue, botState: () => "ready" }),
    { host: "127.0.0.1", port: 0, door: pilot.door });
});
afterEach(async () => {
  await new Promise<void>(resolve => server.server.close(() => resolve()));
  db.close(); observer.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const event = (text: string, sender = "person", chat = "direct") => ({
  event_name: "message.text.received", message: { message_id: String(++serial), date: time, message_type: "CHAT_TEXT",
    from: { id: sender, is_bot: false }, chat: { id: chat, chat_type: "PRIVATE" }, text },
});
const deliver = async (body: unknown, destination = bot, key = destination.secret) => (await fetch(server.baseUrl + destination.path, {
  method: "POST", headers: { "content-type": "application/json", "x-bot-api-secret-token": key }, body: JSON.stringify(body),
})).status;
async function pair() {
  const invite = pilot.invite(bot.endpoint);
  expect(await deliver(event("/pair " + invite.code))).toBe(204);
  const pending = pilot.candidate(bot.endpoint)!;
  expect(pending).toEqual({ id: invite.id, senderId: "person", conversationId: "direct" });
  const grant = pilot.approve(bot.endpoint, pending, 1);
  time++;
  return grant;
}

it("requires the local owner's confirmation and commits scoped text before the HTTP acknowledgement", async () => {
  const invite = pilot.invite(bot.endpoint);
  expect(await deliver(event("pre-consent"))).toBe(204);
  const first = event("/pair " + invite.code);
  expect(await deliver(first)).toBe(204);
  expect(await deliver(event("/pair " + invite.code, "different", "elsewhere"))).toBe(204);
  expect(await deliver(first)).toBe(204);
  expect(observer.prepare("SELECT COUNT(*) AS n FROM zalo_grants").get()?.n).toBe(0);
  const pending = pilot.candidate(bot.endpoint)!;
  expect(() => pilot.approve(bot.endpoint, { ...pending, senderId: "different" }, 1)).toThrow();
  const grant = pilot.approve(bot.endpoint, pending, 1);
  expect(() => pilot.approve(bot.endpoint, pending, 1)).toThrow();
  expect(await deliver(first)).toBe(204);
  expect(inbox.read(grant)).toEqual([]);
  const beforeApproval = event("not authorized yet");
  expect(await deliver(beforeApproval)).toBe(204);
  expect(inbox.read(grant)).toEqual([]);
  time++;
  const input = event("Hẹn đối chiếu công nợ");
  expect(await deliver(input)).toBe(204);
  expect(inbox.read(grant).map(e => e.text)).toEqual([input.message.text]);
  expect(await deliver(input)).toBe(204);
  expect(await deliver({ ...input, message: { ...input.message, text: "other content" } })).toBe(409);
  expect(await deliver(event("unpaired", "stranger"))).toBe(204);
  expect(await deliver(event("other chat", "person", "other"))).toBe(204);
  const group = event("group"); group.message.chat.chat_type = "GROUP";
  expect(await deliver(group)).toBe(204);
  expect(inbox.coverage(grant)?.count).toBe(1);
  expect(enqueue).not.toHaveBeenCalled();
  expect(inbox.beginOfficialPoll(grant)).toBeUndefined();
  expect(pilot.remove(bot.endpoint)).toBe(1);
  expect(await deliver(input)).toBe(403);
  expect(inbox.read(grant)).toEqual([]);
});

it("keeps challenges scoped to their endpoint, expires captured and uncaptured codes, and bounds unique guesses", async () => {
  const other = pilot.register("another");
  const inv = pilot.invite(bot.endpoint);
  expect(await deliver(event("/pair " + inv.code), other, bot.secret)).toBe(403);
  expect(await deliver(event("/pair " + inv.code), other)).toBe(204);
  expect(pilot.candidate(bot.endpoint)).toBeUndefined();
  const wrong = event("/pair wrong");
  for (let i = 0; i < 7; i++) expect(await deliver(wrong)).toBe(204);
  for (let i = 0; i < 4; i++) expect(await deliver(event("/pair wrong"))).toBe(204);
  expect(await deliver(event("/pair " + inv.code))).toBe(429);
  const expired = pilot.invite(bot.endpoint);
  time = expired.expires;
  expect(await deliver(event("/pair " + expired.code))).toBe(204);
  expect(pilot.candidate(bot.endpoint)).toBeUndefined();
  const beforeConfirmation = pilot.invite(bot.endpoint);
  expect(await deliver(event("/pair " + beforeConfirmation.code))).toBe(204);
  const captured = pilot.candidate(bot.endpoint)!;
  time = beforeConfirmation.expires;
  expect(() => pilot.approve(bot.endpoint, captured, 1)).toThrow();
});

it("returns failure on a rolled-back receipt, recovers on redelivery and observes cross-runtime revocation", async () => {
  const grant = await pair(), input = event("fixture");
  db.exec("CREATE TRIGGER simulate_full BEFORE INSERT ON zalo_events BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
  expect(await deliver(input)).toBe(503);
  expect(inbox.read(grant)).toEqual([]);
  db.exec("DROP TRIGGER simulate_full");
  expect(await deliver(input)).toBe(204);
  const second = createZaloWebhookPilot(observer, () => time);
  expect(second.candidate(bot.endpoint)).toBeUndefined();
  expect(second.remove(bot.endpoint)).toBe(1);
  expect(await deliver(input)).toBe(403);
});

it("fails closed for the wrong secret, malformed payload, oversized body or disabled flag", async () => {
  expect(await deliver({ broken: true }, bot, "wrong")).toBe(403);
  expect(await deliver({ broken: true })).toBe(400);
  expect(await deliver({ large: "x".repeat(270_000) })).toBe(413);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "0");
  expect(await deliver(event("hello"))).toBe(404);
  expect(() => pilot.invite(bot.endpoint)).toThrow();
  expect(pilot.remove(bot.endpoint)).toBe(1);
});

it("preserves a pending challenge through receiver restart and checks the grant again after revocation", async () => {
  const invitation = pilot.invite(bot.endpoint);
  const persisted = db.prepare("SELECT secretHash FROM zalo_webhook_endpoints WHERE endpoint=?").get(bot.endpoint);
  expect(persisted?.secretHash).toBeInstanceOf(Uint8Array);
  await new Promise<void>(resolve => server.server.close(() => resolve()));
  db.close();
  db = new DatabaseSync(join(directory, "fixture.sqlite"));
  pilot = createZaloWebhookPilot(db, () => time);
  server = await listenWebhookIngress(new WebhookManager({ file: join(directory, "hooks.json"), enqueue, botState: () => "ready" }),
    { host: "127.0.0.1", port: 0, door: pilot.door });
  expect(await deliver(event("/pair " + invitation.code))).toBe(204);
  const grant = pilot.approve(bot.endpoint, pilot.candidate(bot.endpoint)!, 1);
  time++;
  const prior = event("one");
  expect(await deliver(prior)).toBe(204);
  expect(inbox.revoke(grant)).toBe(true);
  const second = await pair();
  expect(await deliver(prior)).toBe(204);
  expect(inbox.read(second)).toEqual([]);
});

it("rechecks the credential after an in-flight body finishes and the endpoint has been revoked", async () => {
  const firstChunk = new Promise<void>(resolve => {
    server.server.once("request", incoming => incoming.once("data", () => resolve()));
  });
  const response = new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(server.baseUrl + bot.path, { method: "POST",
      headers: { "content-type": "application/json", "x-bot-api-secret-token": bot.secret } }, incoming => {
      incoming.resume();
      resolve(incoming.statusCode);
    });
    outgoing.on("error", reject);
    outgoing.write("{");
    void firstChunk.then(() => {
      createZaloWebhookPilot(observer, () => time).remove(bot.endpoint);
      outgoing.end('"event_name":"message.unsupported.received"}');
    }).catch(reject);
  });
  expect(await response).toBe(403);
});
