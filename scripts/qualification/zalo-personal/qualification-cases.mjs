import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPersonalSessions } from "./personal.mjs";

const { Zalo, GroupMessage, UserMessage } = createRequire(import.meta.url)("zca-js");
const scope = [{ id: "20", type: "group" }, { id: "30", type: "direct" }];
const opts = { accountId: "10", conversations: scope };
function data(idTo, uidFrom) {
  return { msgId: "50", idTo, uidFrom, ts: "1795842000000", msgType: "webchat", content: "Báo giá căn hộ" };
}
function fixture(accountId = "10") {
  const listener = new EventEmitter();
  listener.start = (options) => { assert.deepEqual(options, { retryOnClose: false }); listener.emit("connected"); };
  listener.stop = () => listener.emit("closed");
  const states = [], messages = [], images = [];
  const callbacks = { onQr: (image) => images.push(image), onState: (s) => states.push(s), onMessage: (m) => messages.push(m) };
  const api = { getOwnId: () => accountId, listener };
  return { api, client: { loginQR: async () => api }, callbacks, messages, states, listener, images };
}

test("lab child has no network, write, subprocess, worker or addon permission", () => {
  for (const permission of ["net", "fs.write", "child", "worker", "addons"]) {
    assert.equal(process.permission.has(permission), false);
  }
  assert.equal(process.permission.has("fs.read", fileURLToPath(new URL("../../../package.json", import.meta.url))), false);
});

test("SDK QR flow uses offline transport; decline terminates without credentials, files or retry", async () => {
  const calls = [];
  const image = "iVBORw0KGgo=";
  const polyfill = async (url) => {
    const { hostname, pathname } = new URL(url);
    assert.equal(hostname, "id.zalo.me");
    calls.push(pathname);
    if (pathname === "/account") return new Response('https://stc-zlogin.zdn.vn/main-1.0.js');
    if (pathname.endsWith("/generate")) return Response.json({ data: { code: "fixture", token: "private-fixture", image } });
    if (pathname.endsWith("/waiting-scan")) return Response.json({ data: { avatar: "private-avatar", display_name: "private-name" } });
    if (pathname.endsWith("/waiting-confirm")) return Response.json({ error_code: -13 });
    if (pathname === "/account/logininfo" || pathname === "/account/verify-client") return Response.json({});
    throw new Error("Unexpected fixture request");
  };
  const client = new Zalo({ selfListen: true, logging: false, checkUpdate: false, polyfill });
  const f = fixture();
  const session = createPersonalSessions().begin({ ...opts, ...f.callbacks, client });
  await session.ready;
  assert.deepEqual(f.states, ["awaiting_qr", "awaiting_confirmation", "qr_declined"]);
  assert.deepEqual(f.images, [image]);
  assert.equal(calls.length, 6);
});

test("bound identity, explicit sender direction and conversation type gate each text", async () => {
  const f = fixture();
  const manager = createPersonalSessions();
  const session = manager.begin({ ...opts, ...f.callbacks, client: f.client });
  await session.ready;
  assert.throws(() => manager.begin({ ...opts, ...f.callbacks, client: f.client }), /listener_conflict/);
  const emit = (m) => f.listener.emit("message", m);
  emit(new GroupMessage("10", data("20", "30")));
  emit(new UserMessage("10", data("30", "0")));
  emit(new UserMessage("10", data("0", "30")));
  emit(new GroupMessage("10", data("30", "30")));
  emit(new UserMessage("10", data("0", "20")));
  emit(new GroupMessage("10", { ...data("20", "30"), content: { href: "x" } }));
  emit(new UserMessage("10", data("40", "30")));
  emit(new GroupMessage("10", { ...data("20", "30"), content: "x".repeat(8193) }));
  assert.equal(f.messages.length, 3);
  assert.deepEqual(f.messages[0], {
    adapter: "personal", accountId: "10", conversationId: "20", conversationType: "group",
    messageId: "50", senderId: "30", timestamp: 1795842000000, direction: "incoming", text: "Báo giá căn hộ",
  });
  assert.deepEqual(f.messages.map((m) => m.direction), ["incoming", "outgoing", "incoming"]);
  f.listener.emit("closed", 1006, "private fixture");
  emit(new GroupMessage("10", data("20", "30")));
  f.listener.emit("error", new Error("late fixture error"));
  assert.equal(f.listener.listenerCount("message"), 0);
  assert.equal(session.status(), "coverage_unknown");
  assert.equal(f.messages.length, 3);
});

test("wrong identity, cancellation and stale completions cannot attach a listener", async () => {
  const f = fixture("99");
  const manager = createPersonalSessions();
  const begin = (client) => manager.begin({ ...opts, ...f.callbacks, client });
  const wrong = begin(f.client);
  await wrong.ready;
  assert.equal(wrong.status(), "account_mismatch");
  const delayed = Promise.withResolvers();
  const stale = begin({ loginQR: () => delayed.promise });
  stale.stop();
  const current = fixture();
  const live = begin(current.client);
  delayed.resolve(f.api);
  await Promise.all([stale.ready, live.ready]);
  assert.equal(f.listener.listenerCount("message"), 0);
  assert.equal(live.status(), "listening");
  live.stop();
  assert.equal(live.status(), "disconnected");
});

test("same conversation and message IDs in two accounts retain distinct provenance", async () => {
  const manager = createPersonalSessions();
  const fixtures = ["10", "11"].map((accountId) => {
    const f = fixture(accountId);
    const session = manager.begin({ ...opts, accountId, ...f.callbacks, client: f.client });
    return { ...f, session, accountId };
  });
  for (const f of fixtures) {
    await f.session.ready;
    f.listener.emit("message", new GroupMessage(f.accountId, data("20", "30")));
    assert.deepEqual(f.messages.map((m) => m.accountId), [f.accountId]);
    f.session.stop();
  }
});
