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
  INBOX_PILOT_EMAILS:
    "a@example.test,b@example.test,c@example.test,creator@example.test,member@example.test,owner@example.test,peer@example.test,third@example.test",
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

it("delivers one localized first contact, admits its verified recipient, and honors email suppression", async () => {
  const a = await login("owner@example.test");
  const messages: { to: string; text: string; subject: string }[] = [];
  const mail = {
    EMAIL: {
      send: async (m: (typeof messages)[number]) => {
        messages.push(m);
      },
    } as unknown as InboxEnv["EMAIL"],
  };
  const email = "invited@example.test",
    room = uuid();
  const options = {
    kind: "direct",
    id: room,
    email,
    guest: { locale: "en", note: "Can you check the invoice?" },
  };
  expect((await call("rooms", a.cookie, options, mail)).status).toBe(200);
  await call("rooms", a.cookie, options, mail);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ to: email, subject: "Invitation to chat on StartupBot" });
  expect(messages[0].text).toContain(options.guest.note);
  const token = messages[0].text.match(/#stop=([a-f0-9-]{36})/)![1];
  const b = await login(email);
  expect(await (await call("rooms", b.cookie)).json()).toMatchObject({
    rooms: [{ id: room, state: "pending" }],
  });
  await call("rooms/" + room + "/leave", b.cookie, {});
  await call("me", b.cookie);
  expect(await (await call("rooms", b.cookie)).json()).toEqual({ rooms: [] });
  await call("stop-invitations", "", { token });
  expect(
    await env.INBOX_DB.prepare("SELECT disabled FROM inbox_mail_preferences WHERE email=?")
      .bind(email)
      .first("disabled"),
  ).toBe(1);
  const other = "suppressed@example.test";
  await env.INBOX_DB.prepare("INSERT INTO inbox_mail_preferences(email,token,disabled) VALUES(?,?,1)")
    .bind(other, uuid())
    .run();
  await call("rooms", a.cookie, { ...options, email: other, id: uuid() }, mail);
  expect(messages).toHaveLength(1);
  expect(
    (
      await call(
        "auth/email-otp/send-verification-otp",
        "",
        { email: "stranger@example.test", type: "sign-in" },
        mail,
      )
    ).status,
  ).toBe(200);
  expect(messages).toHaveLength(1);
});

it("stores one attachment on retry, enforces size and withdraws download access after removal", async () => {
  const a = await login("owner@example.test"),
    b = await login("member@example.test");
  const id = uuid(),
    room = "rooms/" + id;
  await call("rooms", a.cookie, { kind: "group", id, title: "Files" });
  await call(room + "/invite", a.cookie, { email: b.email });
  const path = room + "/files/" + uuid();
  async function upload(cookie: string, bytes: Uint8Array<ArrayBuffer>) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(origin + "/api/" + path, {
        method: "POST",
        headers: { origin, cookie, "x-inbox-name": encodeURIComponent("Đối chiếu.xlsx") },
        body: bytes,
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }
  const bytes = new Uint8Array(1048576);
  bytes[0] = 0xff;
  bytes[bytes.length - 1] = 0xfa;
  expect((await upload(b.cookie, bytes)).status).toBe(404);
  await call(room + "/accept", b.cookie, {});
  expect((await upload(a.cookie, new Uint8Array(bytes.length + 1))).status).toBe(413);
  expect((await upload(a.cookie, bytes)).status).toBe(201);
  expect((await upload(a.cookie, bytes)).status).toBe(200);
  const view = await (await call(room, b.cookie)).json<{ posts: { seq: number; kind: string }[] }>();
  expect(view.posts).toHaveLength(1);
  expect(view.posts[0].kind).toBe("file");
  const download = room + "/files/" + view.posts[0].seq;
  const got = await call(download, b.cookie);
  expect(got.headers.get("content-disposition")).toContain("attachment;");
  const content = new Uint8Array(await got.arrayBuffer());
  expect([content.byteLength, content[0], content.at(-1)]).toEqual([bytes.length, 255, 250]);
  await call(room + "/remove", a.cookie, { person: b.id });
  expect((await call(download, b.cookie)).status).toBe(404);
  await call(room + "/close", a.cookie, {});
  expect(await env.INBOX_DB.prepare("SELECT count(*) AS n FROM inbox_files").first("n")).toBe(0);
});
