import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import { createAuth } from "../src/auth";
import { readConfig } from "../src/config";
import worker from "../src/index";
import { sweepMobileDrafts } from "../src/mobile-desktop-drafts";

const origin = "https://auth.openmausbot.test";
const enabled = { ...env, STARTUPBOT_MOBILE_DESKTOP_HANDOFF: "1" };
async function post(path: string, body: unknown, token?: string) {
  const ctx = createExecutionContext();
  const req = new Request(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, enabled, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function owner() {
  const email = crypto.randomUUID() + "@example.test",
    ctx = createExecutionContext();
  const otp = await createAuth(env, ctx, readConfig(env), crypto.randomUUID()).api.createVerificationOTP({
    body: { email, type: "sign-in" },
  });
  await waitOnExecutionContext(ctx);
  const res = await post("/api/auth/sign-in/email-otp", { email, otp, name: "Pilot" });
  expect(res.status).toBe(200);
  return res.headers.get("set-auth-token")!;
}
async function machine(token: string, name: string) {
  const res = await post(
    "/v1/installations",
    { clientInstanceId: crypto.randomUUID(), platform: "darwin", kind: "desktop", name },
    token,
  );
  expect(res.status).toBe(201);
  return res.json<{ installation: { id: string }; credential: string }>();
}
const path = "/v1/mobile-drafts",
  device = "/v1/installations/self/mobile-drafts";
const publicKey = "A".repeat(87) + "=";
it("offers only to the signed-in owner's active receiver and acknowledges only a separately claimed draft", async () => {
  const token = await owner(),
    stranger = await owner(),
    a = await machine(token, "Desk"),
    b = await machine(token, "Laptop"),
    other = await machine(stranger, "Third");
  const listener = crypto.randomUUID(),
    second = crypto.randomUUID(),
    id = crypto.randomUUID(),
    fingerprint = "5".repeat(64);
  const poll = (k: string, l: string) =>
    post(device, { action: "poll", listener: l, publicKey }, k).then((r) => r.json());
  const routing = { id, fingerprint },
    targets = (t = token) => post(path + "/targets", routing, t).then((r) => r.json());
  expect(await targets()).toEqual({ state: "offline" });
  const arm = (token: string, installation: string, listener: string) =>
    post(path + "/arm", { installation, listener, publicKey }, token);
  expect((await arm(stranger, a.installation.id, listener)).status).toBe(409);
  expect((await arm(a.credential, a.installation.id, listener)).status).toBe(401);
  await poll(a.credential, listener);
  expect(await targets()).toEqual({ state: "offline" });
  const third = crypto.randomUUID();
  expect((await arm(stranger, other.installation.id, third)).status).toBe(200);
  await poll(other.credential, third);
  expect(await targets()).toEqual({ state: "offline" });
  expect((await arm(token, a.installation.id, listener)).status).toBe(200);
  await poll(a.credential, listener);
  expect(await targets()).toMatchObject({ state: "ready", id: a.installation.id });
  expect((await arm(token, b.installation.id, second)).status).toBe(200);
  await poll(b.credential, second);
  expect(await targets()).toMatchObject({
    state: "choose",
    devices: expect.arrayContaining([
      { id: a.installation.id, name: "Desk", code: listener.slice(0, 8) },
      { id: b.installation.id, name: "Laptop", code: second.slice(0, 8) },
    ]),
  });
  const envelope = JSON.stringify({ key: publicKey, iv: "A".repeat(16), data: "A".repeat(32) });
  const offer = {
    ...routing,
    target: a.installation.id,
    installation: a.installation.id,
    listener,
    envelope,
  };
  expect(await (await post(path, offer, token)).json()).toEqual({ state: "waiting" });
  expect(await (await post(path, offer, token)).json()).toEqual({ state: "waiting" });
  expect((await post(path, { ...offer, fingerprint: "7".repeat(64) }, token)).status).toBe(409);
  expect(await poll(other.credential, listener)).toEqual({ draft: null });
  expect(await poll(b.credential, second)).toEqual({ draft: null });
  expect(await (await post(device, { action: "poll", listener, publicKey: "B".repeat(87) + "=" }, a.credential)).json()).toEqual({ draft: null });
  expect(await poll(a.credential, listener)).toMatchObject({ draft: { id, envelope } });
  expect(await poll(a.credential, listener)).toEqual({ draft: null });
  const ack = { action: "ack", id, listener };
  expect(await (await post(device, ack, other.credential)).json()).toEqual({ ok: false });
  expect(await (await post(device, ack, a.credential)).json()).toEqual({ ok: true });
  expect(await (await post(path + "/status", { id }, stranger)).json()).toEqual({ state: "expired" });
  expect(await (await post(path + "/status", { id }, token)).json()).toEqual({ state: "received" });
  expect(
    await env.DB.prepare("SELECT envelope FROM mobile_desktop_drafts WHERE id=?").bind(id).first("envelope"),
  ).toBeNull();
});
it("drops expired or signed-out requests and never delivers them on reconnect", async () => {
  const token = await owner(),
    a = await machine(token, "Windows"),
    listener = crypto.randomUUID(),
    id = crypto.randomUUID();
  const poll = () =>
    post(device, { action: "poll", listener, publicKey }, a.credential).then((r) => r.json());
  expect((await post(path + "/arm", { installation: a.installation.id, listener, publicKey }, token)).status).toBe(200);
  await poll();
  const offer = {
    id,
    fingerprint: "a".repeat(64),
    installation: a.installation.id,
    listener,
    envelope: JSON.stringify({ key: publicKey, iv: "A".repeat(16), data: "A".repeat(32) }),
  };
  await post(path, offer, token);
  await env.DB.prepare("UPDATE mobile_desktop_drafts SET expires=0 WHERE id=?").bind(id).run();
  expect(await poll()).toEqual({ draft: null });
  await sweepMobileDrafts(env.DB);
  expect(await env.DB.prepare("SELECT id FROM mobile_desktop_drafts WHERE id=?").bind(id).first()).toBeNull();
  await post(path, { ...offer, id: crypto.randomUUID() }, token);
  expect((await post("/api/auth/sign-out", {}, token)).status).toBe(200);
  expect(await poll()).toEqual({ draft: null });
});
