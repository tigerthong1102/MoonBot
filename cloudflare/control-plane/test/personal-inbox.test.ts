import { env } from "cloudflare:workers";
import {
  type D1Migration,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, afterEach, expect, it } from "vitest";
import worker, { type InboxEnv } from "../src/personal-inbox-worker";

declare global {
  namespace Cloudflare {
    interface Env {
      INBOX_DB: D1Database;
      TEST_INBOX_MIGRATIONS: D1Migration[];
    }
  }
}
beforeAll(() => applyD1Migrations(env.INBOX_DB, env.TEST_INBOX_MIGRATIONS));
afterEach(async () => {
  await env.INBOX_DB.batch(
    ['"user"', '"verification"', '"rateLimit"', "otp_recipient_rate_limits"].map((table) =>
      env.INBOX_DB.prepare("DELETE FROM " + table),
    ),
  );
});

const origin = "https://inbox.example.test";
const testEnv: InboxEnv = {
  ...env,
  DB: env.INBOX_DB,
  BETTER_AUTH_URL: origin,
  EMAIL_FROM: "service@example.test",
  ASSETS: { fetch: async () => new Response("fixture") },
};
const uuid = () => crypto.randomUUID();

async function call(
  path: string,
  cookie = "",
  data?: unknown,
  overrides: Partial<InboxEnv> = {},
  from = origin,
) {
  const ctx = createExecutionContext();
  const req = new Request(origin + "/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { cookie, origin: from, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const res = await worker.fetch(req, { ...testEnv, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function login(email: string) {
  let otp = "";
  const emailBinding = {
    send: async (msg: { text: string }) => {
      otp = msg.text.match(/\b\d{8}\b/)![0];
    },
  } as unknown as InboxEnv["EMAIL"];
  expect(
    (
      await call(
        "auth/email-otp/send-verification-otp",
        "",
        { email, type: "sign-in" },
        { EMAIL: emailBinding },
      )
    ).status,
  ).toBe(200);
  expect(otp).toHaveLength(8);
  const res = await call("auth/sign-in/email-otp", "", { email, otp });
  expect(await res.clone().json()).toEqual({ ok: true });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const me = await call("me", cookie);
  expect(me.status).toBe(200);
  return { cookie, ...(await me.json<{ id: string; email: string }>()) };
}

it("delivers private group invitations, enforces join history and revocation, and saves independent copies", async () => {
  const a = await login("owner@example.test"),
    b = await login("member@example.test"),
    c = await login("third@example.test");
  const id = uuid(),
    room = "rooms/" + id;
  const group = { id, kind: "group", title: "Bàn giao" };
  expect((await call("rooms", a.cookie, group)).status).toBe(200);
  expect((await call("rooms", a.cookie, group)).status).toBe(200);
  expect((await call(room, b.cookie)).status).toBe(404);
  expect((await call(room + "/invite", b.cookie, { email: c.email })).status).toBe(404);
  for (const email of [b.email, c.email, "unknown@example.test"])
    expect(await (await call(room + "/invite", a.cookie, { email })).json()).toEqual({ ok: true });
  expect((await call(room, b.cookie)).status).toBe(404);
  const text = { kind: "text", nonce: uuid(), body: "private before joining" };
  await call(room + "/posts", a.cookie, text);
  expect((await call(room + "/posts", b.cookie, text)).status).toBe(404);
  await call(room + "/accept", b.cookie, {});
  await call(room + "/accept", c.cookie, {});
  const payload = { kind: "task", nonce: uuid(), body: "Đối chiếu tháng 10" };
  const codes = await Promise.all(
    [1, 2].map(async () => (await call(room + "/posts", a.cookie, payload)).status),
  );
  expect(codes).toEqual([200, 200]);
  const view = await (
    await call(room, b.cookie)
  ).json<{ members: unknown[]; posts: { seq: number; body: string }[] }>();
  expect(view.members).toHaveLength(3);
  expect(view.posts.map((p) => p.body)).toEqual([payload.body]);
  const seq = view.posts[0]!.seq;
  expect((await call("saved", b.cookie, { action: "save", seq: seq - 1 })).status).toBe(404);
  expect((await call("saved", b.cookie, { action: "save", seq })).status).toBe(200);
  await call(room + "/remove", a.cookie, { person: b.id });
  expect((await call(room, b.cookie)).status).toBe(404);
  expect((await call(room + "/posts", b.cookie, payload)).status).toBe(404);
  expect((await call(room + "/close", c.cookie, {})).status).toBe(404);
  await call(room + "/close", a.cookie, {});
  expect((await call(room, c.cookie)).status).toBe(404);
  expect((await call("saved", b.cookie, { action: "done", seq })).status).toBe(200);
  expect(await (await call("saved", a.cookie)).json()).toEqual({ saved: [] });
  expect(await (await call("saved", b.cookie)).json()).toMatchObject({
    saved: [{ body: payload.body, done: 1 }],
  });
});

it("protects a direct chat against invite substitution, spam after blocking and expired sessions", async () => {
  const a = await login("a@example.test"),
    b = await login("b@example.test"),
    c = await login("c@example.test");
  const id = uuid(),
    room = "rooms/" + id,
    input = { kind: "direct", email: b.email, id };
  expect((await call("rooms", "", input)).status).toBe(401);
  expect((await call("rooms", a.cookie, input, {}, "https://else.example.test")).status).toBe(403);
  await call("rooms", a.cookie, input);
  await call("rooms", a.cookie, { ...input, email: c.email });
  expect(await (await call("rooms", c.cookie)).json()).toEqual({ rooms: [] });
  const message = { nonce: uuid(), kind: "skill", body: "# Checklist" };
  expect((await call(room + "/posts", a.cookie, message)).status).toBe(404);
  await call(room + "/accept", b.cookie, {});
  expect((await call(room + "/posts", a.cookie, message)).status).toBe(200);
  expect(
    (await call(room + "/posts", a.cookie, { ...message, nonce: uuid(), body: "sk-proj-" + "a".repeat(32) }))
      .status,
  ).toBe(400);
  expect((await call(room + "/invite", a.cookie, { email: c.email })).status).toBe(404);
  await call(room + "/block", b.cookie, {});
  await call("rooms", a.cookie, { ...input, id: uuid() });
  expect(await (await call("rooms", b.cookie)).json()).toEqual({ rooms: [] });
  expect((await call(room + "/posts", a.cookie, message)).status).toBe(404);
  await call("auth/sign-out", a.cookie, {});
  expect((await call("me", a.cookie)).status).toBe(401);
});

it("lets either direct participant block further invitations, and unblock explicitly", async () => {
  const a = await login("creator@example.test"),
    b = await login("peer@example.test");
  const id = uuid(),
    group = uuid();
  await call("rooms", a.cookie, { kind: "direct", email: b.email, id });
  await call("rooms/" + id + "/accept", b.cookie, {});
  await call("rooms", b.cookie, { kind: "group", title: "Project", id: group });
  await call("rooms/" + group + "/invite", b.cookie, { email: a.email });
  expect((await call("rooms/" + id + "/block", a.cookie, {})).status).toBe(200);
  expect(await (await call("rooms", a.cookie)).json()).toEqual({ rooms: [] });
  expect(await (await call("blocks", a.cookie)).json()).toMatchObject({ people: [{ email: b.email }] });
  await call("rooms/" + group + "/invite", b.cookie, { email: a.email });
  expect(await (await call("rooms", a.cookie)).json()).toEqual({ rooms: [] });
  await call("blocks", a.cookie, { person: b.id });
  await call("rooms/" + group + "/invite", b.cookie, { email: a.email });
  expect(await (await call("rooms", a.cookie)).json()).toMatchObject({
    rooms: [{ id: group, state: "pending" }],
  });
});
