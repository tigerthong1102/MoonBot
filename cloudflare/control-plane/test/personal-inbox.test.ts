import { brotliCompressSync, gzipSync } from "node:zlib";
import { env } from "cloudflare:workers";
import {
  type D1Migration,
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, afterEach, expect, it } from "vitest";
import worker, { type InboxEnv } from "../src/personal-inbox-worker";
import { botClaimBytes, proofUsername } from "../../../shared/bot-proof";
import { createPersonalInboxClaims } from "../../../electron/personal-inbox-claims.mjs";

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
  language = "en",
  languageSource = "app",
  invite?: string,
) {
  const ctx = createExecutionContext();
  const req = new Request(origin + "/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      cookie,
      origin: from,
      "content-type": "application/json",
      "x-inbox-language": language,
      "x-inbox-language-source": languageSource,
      ...(invite ? { "x-inbox-invite": invite } : {}),
    },
    body: JSON.stringify(data),
  });
  const res = await worker.fetch(req, { ...testEnv, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function login(email: string, invite?: string) {
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
        origin,
        "en",
        "app",
        invite,
      )
    ).status,
  ).toBe(200);
  expect(otp).toHaveLength(8);
  const res = await call("auth/sign-in/email-otp", "", { email, otp }, {}, origin, "en", "app", invite);
  expect(await res.clone().json()).toEqual({ ok: true });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const me = await call("me", cookie);
  expect(me.status).toBe(200);
  return { cookie, ...(await me.json<{ id: string; email: string }>()) };
}

it("opens one direct conversation from New Group across both accounts", async () => {
  const a = await login("a@example.test"), b = await login("b@example.test");
  const results = await Promise.all([
    call("rooms", a.cookie, { kind: "direct", id: uuid(), email: b.email, instant: true }),
    call("rooms", b.cookie, { kind: "direct", id: uuid(), email: a.email, instant: true }),
  ]);
  expect(results.map(result => result.status)).toEqual([200, 200]);
  const [{ id }, second] = await Promise.all(results.map(result => result.json<{ id: string }>()));
  expect(second.id).toBe(id);
  const message = { nonce: uuid(), kind: "text", body: "Hello from New Group" };
  const room = "rooms/" + id;
  expect((await call(room + "/posts", a.cookie, message)).status).toBe(200);
  expect(await (await call(room, b.cookie)).json()).toMatchObject({ posts: [{ body: message.body }] });
  expect((await call(room + "/block", b.cookie, {})).status).toBe(200);
  await call("rooms", a.cookie, { kind: "direct", id: uuid(), email: b.email, instant: true });
  expect(await (await call("rooms", b.cookie)).json()).toEqual({ rooms: [] });
  await call("rooms", b.cookie, { kind: "direct", id: uuid(), email: a.email, instant: true });
  expect((await (await call("rooms", a.cookie)).json<{ rooms: { id: string }[] }>()).rooms.map(r => r.id)).toEqual([id]);
});

it("auto-adds verified invitees, sends a guest invitation, and remembers group departures", async () => {
  const a = await login("a@example.test"), b = await login("b@example.test"), c = await login("c@example.test");
  const id = uuid(), room = "rooms/" + id;
  const guest = { locale: "vi", note: "" }, external = "new-group-guest@example.test";
  const sent: { to: string; text: string }[] = [];
  const EMAIL = { send: async (message: { to: string; text: string }) => { sent.push(message); } } as unknown as InboxEnv["EMAIL"];
  const group = { kind: "group", id, title: "Test group", invitees: [b.email, b.email.toUpperCase(), external], guest };
  expect((await call("rooms", a.cookie, group, { EMAIL })).status).toBe(200);
  expect((await call("rooms", a.cookie, group, { EMAIL })).status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ to: external });
  expect(sent[0]!.text).toContain("#room=" + id);
  expect(await (await call("rooms", b.cookie)).json()).toMatchObject({ rooms: [{ id, state: "active", admin: 0 }] });
  const old = { nonce: uuid(), kind: "text", body: "Posted before the new member" };
  expect((await call(room + "/posts", b.cookie, old)).status).toBe(200);
  expect((await call(room + "/invite", b.cookie, { email: c.email, instant: true })).status).toBe(404);
  const invite = { email: c.email, instant: true };
  expect((await call(room + "/invite", a.cookie, invite)).status).toBe(200);
  expect(await (await call(room, c.cookie)).json()).toMatchObject({ posts: [] });
  const newer = { nonce: uuid(), kind: "text", body: "Posted after the new member" };
  expect((await call(room + "/posts", a.cookie, newer)).status).toBe(200);
  expect(await (await call(room, c.cookie)).json()).toMatchObject({ posts: [{ body: newer.body }] });
  expect((await call(room + "/leave", c.cookie, {})).status).toBe(200);
  expect((await call(room + "/invite", a.cookie, invite)).status).toBe(200);
  expect(await (await call("rooms", c.cookie)).json()).toMatchObject({ rooms: [{ id, state: "pending" }] });
  expect((await call(room, c.cookie)).status).toBe(404);
  expect((await call(room + "/block", c.cookie, {})).status).toBe(200);
  expect((await call(room + "/invite", a.cookie, invite)).status).toBe(200);
  expect(await (await call("rooms", c.cookie)).json()).toEqual({ rooms: [] });
  expect((await call(room + "/close", a.cookie, {})).status).toBe(200);
});

it("requires consent for instant invites to groups without a complete departure history", async () => {
  const owner = await login("owner@example.test"), former = await login("member@example.test");
  const id = uuid(), room = "rooms/" + id;
  await env.INBOX_DB.prepare("INSERT INTO inbox_rooms(id,kind,title,owner,created) VALUES(?,'group',?,?,?)")
    .bind(id, "Legacy group", owner.id, Date.now()).run();
  expect((await call(room + "/invite", owner.cookie, { email: former.email, instant: true })).status).toBe(200);
  expect(await (await call("rooms", former.cookie)).json()).toMatchObject({ rooms: [{ id, state: "pending" }] });
  expect((await call(room, former.cookie)).status).toBe(404);
  expect((await call(room + "/accept", former.cookie, {})).status).toBe(200);
  expect((await call(room, former.cookie)).status).toBe(200);
});

it("sends full-length multilingual posts while bounding unrelated JSON requests", async () => {
  const account = await login("owner@example.test");
  const id = uuid();
  expect((await call("rooms", account.cookie, { kind: "group", id, title: "文字" })).status).toBe(200);
  for (const kind of ["text", "skill", "task"]) {
    const body = "日本語文".repeat(2000);
    const path = "rooms/" + id + "/posts";
    expect((await call(path, account.cookie, { kind, nonce: uuid(), body })).status).toBe(200);
    expect((await call(path, account.cookie, { kind, nonce: uuid(), body: body + "字" })).status).toBe(400);
  }
  expect((await call("rooms", account.cookie, { id: uuid(), kind: "group", title: "語".repeat(8000) })).status).toBe(413);
});

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
  const memberRooms = async () => (await call("rooms", b.cookie)).json();
  expect(await memberRooms()).toMatchObject({ rooms: [{ id, snippet: null }] });
  const openRoom = "rooms?open=" + id;
  expect(await (await call(openRoom, b.cookie)).json()).toMatchObject({ detail: null });
  await call(room + "/accept", b.cookie, {});
  expect(await memberRooms()).toMatchObject({ rooms: [{ id, snippet: null }] });
  expect(await (await call(openRoom, b.cookie)).json()).toMatchObject({ detail: { posts: [] } });
  await call(room + "/accept", c.cookie, {});
  const payload = { kind: "task", nonce: uuid(), body: "Đối chiếu tháng 10" };
  const codes = await Promise.all(
    [1, 2].map(async () => (await call(room + "/posts", a.cookie, payload)).status),
  );
  expect(codes).toEqual([200, 200]);
  expect(await memberRooms()).toMatchObject({ rooms: [{ id, snippet: payload.body }] });
  const view = await (
    await call(room, b.cookie)
  ).json<{ members: unknown[]; posts: { seq: number; body: string }[] }>();
  expect(view.members).toHaveLength(3);
  expect(view.posts.map((p) => p.body)).toEqual([payload.body]);
  const seq = view.posts[0]!.seq;
  expect(await (await call(openRoom + "&latest=0", b.cookie)).json()).toMatchObject({ detail: view });
  const revision = (await (await call(openRoom, b.cookie)).json<{rooms:{revision:number}[]}>()).rooms[0]!.revision;
  const idle = await (await call(openRoom + "&latest=" + seq + "&revision=" + revision, b.cookie)).json();
  expect(idle).toMatchObject({ unchanged: true });
  expect(idle).not.toHaveProperty("detail");
  expect((await call("saved", b.cookie, { action: "save", seq: seq - 1 })).status).toBe(404);
  expect((await call("saved", b.cookie, { action: "save", seq })).status).toBe(200);
  expect((await call("saved/" + seq + "/download", b.cookie)).status).toBe(404);
  const skillBody = "# Kỹ năng đối chiếu\n\nĐọc chứng từ.";
  await call(room + "/posts", a.cookie, { kind: "skill", nonce: uuid(), body: skillBody });
  const skillView = await (await call(room, b.cookie)).json<{ posts: { seq: number; body: string }[] }>();
  const skillSeq = skillView.posts.find(p => p.body === skillBody)!.seq;
  const skillPath = "saved/" + skillSeq + "/download";
  expect((await call("saved", b.cookie, { action: "save", seq: skillSeq })).status).toBe(200);
  await call(room + "/remove", a.cookie, { person: b.id });
  expect(await (await call(openRoom + "&latest=" + seq, b.cookie)).json()).toMatchObject({ rooms: [], detail: null });
  expect((await call(room, b.cookie)).status).toBe(404);
  expect((await call(room + "/posts", b.cookie, payload)).status).toBe(404);
  expect((await call(room + "/close", c.cookie, {})).status).toBe(404);
  await call(room + "/close", a.cookie, {});
  expect((await call(room, c.cookie)).status).toBe(404);
  expect((await call("saved", b.cookie, { action: "done", seq })).status).toBe(200);
  expect(await (await call("saved", a.cookie)).json()).toEqual({ saved: [] });
  expect(await (await call("saved", b.cookie)).json()).toMatchObject({
    saved: [{ body: skillBody }, { body: payload.body, done: 1 }],
  });
  expect((await call(skillPath)).status).toBe(401);
  expect((await call(skillPath, a.cookie)).status).toBe(404);
  const skillDownload = await call(skillPath, b.cookie);
  expect(skillDownload.headers.get("content-disposition")).toBe('attachment; filename="SKILL.md"');
  expect(await skillDownload.text()).toBe(skillBody);
  expect((await call("saved", b.cookie, { action: "delete", seq: skillSeq })).status).toBe(200);
  expect((await call(skillPath, b.cookie)).status).toBe(404);
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

it("reopens the same private conversation for simultaneous requests by either participant", async () => {
  const a = await login("a@example.test"), b = await login("b@example.test");
  const create = async (sender: typeof a, peer: typeof b) =>
    (await call("rooms", sender.cookie, { id: uuid(), kind: "direct", email: peer.email })).json<{ id: string }>();
  const [first, second] = await Promise.all([create(a, b), create(b, a)]);
  expect(first.id).toBeTruthy();
  expect(second.id).toBe(first.id);
  const rooms = async (cookie: string) => (await call("rooms", cookie)).json<{ rooms: { state: string }[] }>();
  const pending = (await rooms(a.cookie)).rooms[0]!.state === "pending" ? a : b;
  expect((await rooms(pending.cookie)).rooms).toHaveLength(1);
  expect((await call("rooms/" + first.id + "/accept", pending.cookie, {})).status).toBe(200);
  expect(await create(a, b)).toEqual(first);
  expect(await create(b, a)).toEqual(first);
});

it("returns the same public acknowledgement for all sign-in code requests", async () => {
  const send = (email: string) => call("auth/email-otp/send-verification-otp", "", { email, type: "sign-in" },
    { EMAIL: { send: async () => {} } as unknown as InboxEnv["EMAIL"] });
  for (const email of [...Array<string>(4).fill("a@example.test"), "unknown@example.test"]) {
    const result = await send(email);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
  }
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
    guest: { locale: "fr", note: "On en parle demain ?" },
  };
  expect((await call("rooms", a.cookie, options, mail)).status).toBe(200);
  await call("rooms", a.cookie, options, mail);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ to: email, subject: "Invitation à discuter sur StartupBot" });
  expect(messages[0].text).toContain(options.guest.note);
  expect(messages[0].text).toContain("/?lang=fr#room=" + room);
  const token = messages[0].text.match(/#stop=([a-f0-9-]{36})/)![1];
  const b = await login(email);
  expect((await call("language", b.cookie, {locale:"ja"})).status).toBe(200);
  expect(await (await call("me", b.cookie)).json()).toMatchObject({locale:"ja"});
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

it("uses a verified recipient's saved language for default email and honors an explicit app selection", async () => {
  const owner = await login("peer@example.test");
  expect((await call("language", owner.cookie, {locale:"fr"})).status).toBe(200);
  const delivered: { subject: string; text: string }[] = [];
  const mail = {EMAIL:{send:async (message: typeof delivered[number]) => { delivered.push(message); }} as unknown as InboxEnv["EMAIL"]};
  const send = (source: string) => call("auth/email-otp/send-verification-otp", "", {email:owner.email, type:"sign-in"},
    mail, origin, "en-US", source);
  expect((await send("default")).status).toBe(200);
  expect(delivered[0]?.subject).toBe("Votre code de connexion StartupBot");
  expect(delivered[0]?.text).toMatch(/Votre code de connexion est \d{8}/);
  expect((await send("app")).status).toBe(200);
  expect(delivered[1]?.subject).toBe("Your StartupBot sign-in code");
});

it("stores one attachment on retry, enforces size and withdraws download access after removal", async () => {
  const a = await login("owner@example.test"),
    b = await login("member@example.test");
  const id = uuid(),
    room = "rooms/" + id;
  await call("rooms", a.cookie, { kind: "group", id, title: "Files" });
  await call(room + "/invite", a.cookie, { email: b.email });
  const path = room + "/files/" + uuid();
  async function upload(cookie: string, bytes: Uint8Array<ArrayBuffer>, uploadPath = path) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(origin + "/api/" + uploadPath, {
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
  const bytes = new Uint8Array(20_000_000);
  for (let i = 0; i < bytes.length; i += 499979) bytes[i] = (i % 251) + 1;
  bytes[0] = 0xff;
  bytes[bytes.length - 1] = 0xfa;
  expect((await upload(b.cookie, bytes)).status).toBe(404);
  await call(room + "/accept", b.cookie, {});
  expect((await upload(a.cookie, new Uint8Array(20_000_001))).status).toBe(413);
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
  expect((await call(download + "?preview=1", b.cookie)).status).toBe(415);
  const compressedPath = room + "/files/" + uuid();
  const asBytes = (data: Uint8Array) => new Uint8Array(data);
  const packed = asBytes(gzipSync(bytes));
  expect((await upload(a.cookie, packed, compressedPath + "/gzip")).status).toBe(201);
  expect((await upload(a.cookie, bytes, compressedPath)).status).toBe(200);
  const packedPost = await env.INBOX_DB.prepare("SELECT max(post) AS seq FROM inbox_uploads").first<number>("seq");
  const packedDownload = room + "/files/" + packedPost;
  const packedRead = new Uint8Array(await (await call(packedDownload, b.cookie)).arrayBuffer());
  expect(new Uint8Array(await crypto.subtle.digest("SHA-256", packedRead)))
    .toEqual(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  expect((await upload(a.cookie, asBytes(gzipSync(new Uint8Array(20_000_001))), compressedPath + "/gzip")).status).toBe(413);
  expect((await upload(a.cookie, new Uint8Array([1,2,3]), compressedPath + "/gzip")).status).toBe(400);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  expect((await upload(a.cookie, png, room + "/files/" + uuid())).status).toBe(201);
  const latest = await (await call(room, b.cookie)).json<{ posts: { seq: number; fileSize: number }[] }>();
  const post = latest.posts.at(-1)!;
  expect(post.fileSize).toBe(png.byteLength);
  const preview = room + "/files/" + post.seq + "?preview=1";
  const image = await call(preview, b.cookie);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  expect(new Uint8Array(await crypto.subtle.digest("SHA-256", content))).toEqual(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  const legacyNonce = uuid();
  const legacyBytes = new Uint8Array([68, 49]);
  const legacyDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", legacyBytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  await env.INBOX_DB.prepare(
    "INSERT INTO inbox_files(room,author,nonce,name,digest,bytes,created) VALUES (?,?,?,?,?,?,?)",
  ).bind(id, a.id, legacyNonce, "Đối chiếu.xlsx", legacyDigest, legacyBytes.buffer, Date.now()).run();
  const legacyRetry = room + "/files/" + legacyNonce;
  expect((await upload(a.cookie, legacyBytes, legacyRetry)).status).toBe(200);
  expect((await upload(a.cookie, new Uint8Array([68, 50]), legacyRetry)).status).toBe(409);
  expect(await env.INBOX_DB.prepare("SELECT count(*) AS n FROM inbox_uploads WHERE nonce=?").bind(legacyNonce).first("n")).toBe(0);
  const legacy = await env.INBOX_DB.prepare("SELECT post FROM inbox_files WHERE room=?").bind(id).first<number>("post");
  const oldFile = await call(room + "/files/" + legacy, b.cookie);
  expect(new Uint8Array(await oldFile.arrayBuffer())).toEqual(new Uint8Array([68,49]));
  for (let i = 0; i < 2; i++)
    await env.INBOX_DB.prepare(
      "INSERT INTO inbox_uploads(id,room,author,nonce,name,digest,size,created) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(uuid(), id, a.id, uuid(), "pending", "fixture", 20_000_000, Date.now()).run();
  expect((await upload(a.cookie, png, room + "/files/" + uuid())).status).toBe(409);
  expect((await upload(a.cookie, bytes)).status).toBe(200);
  await env.INBOX_DB.prepare("INSERT INTO inbox_upload_allowance(person,reset_at) VALUES(?,?)").bind(a.id, Date.now()).run();
  expect((await upload(a.cookie, png, room + "/files/" + uuid())).status).toBe(201);
  await call(room + "/remove", a.cookie, { person: b.id });
  expect((await call(preview, b.cookie)).status).toBe(404);
  expect((await call(download, b.cookie)).status).toBe(404);
  await call(room + "/close", a.cookie, {});
  for (const table of ["inbox_files", "inbox_uploads", "inbox_upload_parts"])
    expect(await env.INBOX_DB.prepare("SELECT count(*) AS n FROM " + table).first("n")).toBe(0);
});

it("publishes small compressed Markdown once and preserves its original bytes", async () => {
  const owner = await login("owner@example.test"), member = await login("member@example.test");
  const id = uuid(), room = "rooms/" + id;
  await call("rooms", owner.cookie, { kind: "group", id, title: "Markdown" });
  await call(room + "/invite", owner.cookie, { email: member.email });
  await call(room + "/accept", member.cookie, {});
  const bytes = new TextEncoder().encode("# Checklist\n- Đối chiếu số liệu.\n".repeat(31_000));
  expect(bytes.length).toBeGreaterThan(750_000);
  expect(bytes.length).toBeLessThan(1_500_000);
  const path = room + "/files/" + uuid() + "/gzip";
  const send = async (source: Uint8Array<ArrayBuffer>) => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(origin + "/api/" + path, {
      method: "POST", headers: { origin, cookie: owner.cookie, "x-inbox-name": "SKILL.md" },
      body: new Uint8Array(gzipSync(source)),
    }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    return response.status;
  };
  expect((await Promise.all([send(bytes), send(bytes)])).sort()).toEqual([200, 201]);
  expect(await send(new TextEncoder().encode("# changed"))).toBe(409);
  const { posts } = await (await call(room, member.cookie)).json<{ posts: { seq: number; fileSize: number }[] }>();
  expect(posts).toHaveLength(1);
  expect(posts[0].fileSize).toBe(bytes.length);
  const copy = await call(room + "/files/" + posts[0].seq, member.cookie);
  expect(await copy.arrayBuffer()).toEqual(bytes.buffer);
});

it("streams a bounded voice attachment only to members, with byte ranges and a download", async () => {
  const owner = await login("owner@example.test");
  const member = await login("member@example.test");
  const id = uuid(), room = "rooms/" + id;
  await call("rooms", owner.cookie, { kind: "group", id, title: "Voice room" });
  await call(room + "/invite", owner.cookie, { email: member.email });
  await call(room + "/accept", member.cookie, {});
  const sample = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
  const upload = async (bytes: Uint8Array<ArrayBuffer>) => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(origin + "/api/" + room + "/files/" + uuid(), {
      method: "POST", headers: { origin, cookie: owner.cookie, "x-inbox-name": "startupbot-voice.webm" }, body: bytes,
    }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(201);
    const { posts } = await (await call(room, owner.cookie)).json<{ posts: { seq: number }[] }>();
    return room + "/files/" + posts.at(-1)!.seq;
  };
  const clip = await upload(sample);
  const unsupported = await upload(new Uint8Array([0x48, 0x54, 0x4d, 0x4c]));
  expect((await call(unsupported + "?play=1", member.cookie)).status).toBe(415);
  const played = await call(clip + "?play=1", member.cookie);
  expect(played.headers.get("content-type")).toBe("audio/webm");
  expect(played.headers.get("x-content-type-options")).toBe("nosniff");
  expect(played.headers.has("content-disposition")).toBe(false);
  expect(new Uint8Array(await played.arrayBuffer())).toEqual(sample);
  async function range(value: string) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(origin + "/api/" + clip + "?play=1", {
      headers: { cookie: member.cookie, range: value },
    }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }
  const part = await range("bytes=0-1");
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe("bytes 0-1/5");
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(sample.slice(0, 2));
  expect((await range("bytes=5-")).status).toBe(416);
  expect((await call(clip, member.cookie)).headers.get("content-disposition")).toMatch(/^attachment;/);
  await call(room + "/remove", owner.cookie, { person: member.id });
  expect((await call(clip + "?play=1", member.cookie)).status).toBe(404);
});

it("resumes verified parallel file parts and publishes once after checking membership", async () => {
  const a = await login("owner@example.test"), b = await login("member@example.test");
  const id = uuid(), room = "rooms/" + id;
  const path = room + "/files/" + uuid();
  await call("rooms", a.cookie, { kind: "group", id, title: "Parallel files" });
  await call(room + "/invite", a.cookie, { email: b.email });
  await call(room + "/accept", b.cookie, {});
  const parts = [new Uint8Array(750000).fill(65), new Uint8Array([1,2,3])];
  const hashes = await Promise.all(parts.map(async (part) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", part)), (n) => n.toString(16).padStart(2, "0")).join("")));
  const manifest = { size: 750003, hashes };
  const post = async (route: string, cookie: string, data: BodyInit, type: string, encoding = "identity", count = 1) => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(origin + "/api/" + route, {
      method: "POST", headers: { origin, cookie, "content-type": type, "x-inbox-name": "document.pdf", "x-inbox-encoding": encoding, "x-inbox-parts": String(count) },
      body: data,
    }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
  const begin = (route = path) => post(route + "/start", b.cookie, JSON.stringify(manifest), "application/json");
  expect((await begin()).status).toBe(200);
  expect((await post(path + "/1", b.cookie, new Uint8Array([9,9,9]), "application/octet-stream")).status).toBe(400);
  expect((await post(path + "/1", a.cookie, parts[1], "application/octet-stream")).status).toBe(404);
  expect((await post(path + "/1", b.cookie, parts[1], "application/octet-stream")).status).toBe(200);
  expect(await (await begin()).json()).toEqual({ published: false, received: [1] });
  expect((await call(path + "/complete", b.cookie, {})).status).toBe(409);
  expect((await post(path + "/0", b.cookie, new Uint8Array(gzipSync(parts[0])), "application/octet-stream", "gzip")).status).toBe(200);
  await Promise.all([0,1].map(async () => expect((await call(path + "/complete", b.cookie, {})).status).toBe(200)));
  const { posts } = await (await call(room, a.cookie)).json<{posts:{seq:number}[]}>();
  expect(posts).toHaveLength(1);
  const copy = new Uint8Array(await (await call(room + "/files/" + posts[0].seq, a.cookie)).arrayBuffer());
  expect(copy.byteLength).toBe(750003);
  expect(copy.slice(749999)).toEqual(new Uint8Array([65,1,2,3]));
  const second = room + "/files/" + uuid();
  await begin(second);
  expect((await post(second + "/start", b.cookie, JSON.stringify({ size: 50_000_001, hashes: Array(67).fill(hashes[0]) }), "application/json")).status).toBe(400);
  const joined = new Uint8Array(750003);
  joined.set(parts[0]); joined.set(parts[1], 750000);
  joined[750002] = 4;
  expect((await post(second + "/0", b.cookie, new Uint8Array(gzipSync(joined)), "application/octet-stream", "gzip", 2)).status).toBe(400);
  expect(await (await begin(second)).json()).toMatchObject({ received: [] });
  joined[750002] = 3;
  expect((await post(second + "/0", b.cookie, new Uint8Array(gzipSync(joined)), "application/octet-stream", "gzip", 2)).status).toBe(200);
  expect(await (await begin(second)).json()).toMatchObject({ received: [0,1] });
  const rawPath = room + "/files/" + uuid();
  await begin(rawPath);
  expect((await post(rawPath + "/0", b.cookie, joined, "application/octet-stream", "identity", 3)).status).toBe(400);
  expect((await post(rawPath + "/0", b.cookie, joined.slice(0, -1), "application/octet-stream", "identity", 2)).status).toBe(400);
  const corrupt = joined.slice();
  corrupt[750002] = 4;
  expect((await post(rawPath + "/0", b.cookie, corrupt, "application/octet-stream", "identity", 2)).status).toBe(400);
  expect(await (await begin(rawPath)).json()).toMatchObject({ received: [] });
  expect((await post(rawPath + "/0", b.cookie, joined, "application/octet-stream", "identity", 2)).status).toBe(200);
  expect((await post(rawPath + "/0", b.cookie, joined, "application/octet-stream", "identity", 2)).status).toBe(200);
  expect(await (await begin(rawPath)).json()).toMatchObject({ received: [0,1] });
  expect((await call(rawPath + "/complete", b.cookie, {})).status).toBe(200);
  const rawPosts = await (await call(room, a.cookie)).json<{ posts: { seq: number }[] }>();
  const rawDownload = await call(room + "/files/" + rawPosts.posts.at(-1)!.seq, a.cookie);
  expect(new Uint8Array(await rawDownload.arrayBuffer())).toEqual(joined);
  const four = room + "/files/" + uuid();
  const fourParts = new Uint8Array(2_250_003).fill(65);
  fourParts.set(parts[1], 2_250_000);
  expect((await post(four + "/start", b.cookie, JSON.stringify({
    size: fourParts.length, hashes: [hashes[0], hashes[0], hashes[0], hashes[1]],
  }), "application/json")).status).toBe(200);
  expect((await post(four + "/0", b.cookie, fourParts, "application/octet-stream", "identity", 4)).status).toBe(200);
  expect((await call(four + "/complete", b.cookie, {})).status).toBe(200);
  const brPath = room + "/files/" + uuid();
  await begin(brPath);
  expect((await post(brPath + "/0", b.cookie, new Uint8Array(brotliCompressSync(joined)), "application/octet-stream", "br", 2)).status).toBe(200);
  expect((await post(brPath + "/complete", b.cookie, "{}", "application/json")).status).toBe(200);
  await call(room + "/remove", a.cookie, { person: b.id });
  expect((await post(second + "/0", b.cookie, parts[0], "application/octet-stream")).status).toBe(404);
  expect((await call(second + "/complete", b.cookie, {})).status).toBe(404);
});

it("enforces group management on the server across role changes, links, bans, messages and transfers", async () => {
  const owner = await login("owner@example.test"), admin = await login("member@example.test"), member = await login("third@example.test");
  const id = uuid(), room = "rooms/" + id;
  const mod = (who: typeof owner, action: string, fields = {}) => call(room + "/moderate",who.cookie,{action,...fields});
  const target = {person: member.id};
  const write = (who: typeof owner) => call(room+"/posts",who.cookie,{nonce:uuid(),kind:"text",body:"message"});
  const join = (token: string) => call("join",member.cookie,{token});
  const detail = async (who: typeof owner) => (await call(room,who.cookie)).json<{
    group:{link:string; owner:string}; posts:{seq:number}[]; requests:{id:string}[]; bans:{id:string}[];
  }>();
  await call("rooms",owner.cookie,{id,kind:"group",title:"Team"});
  await call(room+"/invite",owner.cookie,{email:admin.email});
  await call(room+"/accept",admin.cookie,{});
  expect((await mod(admin,"promote",{person:admin.id})).status).toBe(404);
  expect((await mod(owner,"promote",{person:admin.id})).status).toBe(200);
  expect((await mod(admin,"newLink")).status).toBe(200);
  await call(room+"/invite",admin.cookie,{email:member.email});
  expect((await mod(admin,"cancelInvite",{email:member.email})).status).toBe(200);
  expect((await call(room+"/accept",member.cookie,{})).status).toBe(404);
  const oldKey=(await detail(admin)).group.link;
  expect(await (await mod(admin,"ensureLink")).json()).toEqual({token:oldKey});
  expect((await mod(member,"ensureLink")).status).toBe(404);
  expect(await (await call("join/preview","",{token:oldKey})).json()).toEqual({title:"Team",approval:1});
  expect(await (await join(oldKey)).json()).toEqual({id,state:"requested"});
  expect((await call(room,member.cookie)).status).toBe(404);
  expect((await detail(admin)).requests).toMatchObject([{id:member.id}]);
  await mod(owner,"revokeLink");
  expect((await join(oldKey)).status).toBe(404);
  expect((await detail(admin)).requests).toEqual([]);
  await mod(owner,"newLink");
  const key=(await detail(admin)).group.link;
  await join(key); expect((await mod(admin,"deny",target)).status).toBe(200);
  await join(key); await write(owner);
  expect((await mod(admin,"approve",target)).status).toBe(200);
  expect((await detail(member)).posts).toEqual([]);
  expect((await mod(member,"rename",{title:"New"})).status).toBe(404);
  expect((await mod(admin,"rename",{title:"New"})).status).toBe(200);
  expect((await mod(admin,"ban",{person:owner.id})).status).toBe(404);
  expect((await mod(admin,"transfer",target)).status).toBe(404);
  expect((await mod(admin,"announcements",{enabled:true})).status).toBe(200);
  expect((await write(member)).status).toBe(404);
  expect((await write(admin)).status).toBe(200);
  await mod(admin,"announcements",{enabled:false});
  await mod(admin,"mute",target);
  expect((await write(member)).status).toBe(404);
  await mod(admin,"approval",{enabled:false});
  await call(room+"/leave",member.cookie,{});
  expect(await (await join(key)).json()).toEqual({id,state:"active"});
  expect((await write(member)).status).toBe(404);
  const ctx = createExecutionContext();
  const restrictedFile = await worker.fetch(new Request(origin+"/api/"+room+"/files/"+uuid()+"/start",{
    method:"POST",headers:{origin,cookie:member.cookie,"x-inbox-name":"example.md","content-type":"application/json"},
    body:JSON.stringify({size:1,hashes:["0".repeat(64)]}),
  }),testEnv,ctx);
  expect(restrictedFile.status).toBe(409);
  await waitOnExecutionContext(ctx);
  await mod(admin,"unmute",target);
  expect((await write(member)).status).toBe(200);
  const seq=(await detail(member)).posts.at(-1)!.seq;
  expect((await mod(admin,"deletePost",{seq})).status).toBe(200);
  expect((await detail(member)).posts).toEqual([]);
  await write(owner);
  expect((await mod(admin,"deletePost",{seq:(await detail(admin)).posts.at(-1)!.seq})).status).toBe(404);
  await mod(admin,"ban",target);
  expect((await detail(admin)).bans).toMatchObject([{id:member.id}]);
  expect((await join(key)).status).toBe(404);
  await call(room+"/invite",admin.cookie,{email:member.email});
  expect((await call(room+"/accept",member.cookie,{})).status).toBe(404);
  await mod(admin,"unban",target);
  expect((await join(key)).status).toBe(200);
  await mod(owner,"demote",{person:admin.id});
  expect((await mod(admin,"remove",target)).status).toBe(404);
  await mod(owner,"transfer",target);
  expect((await detail(member)).group.owner).toBe(member.id);
  expect((await call(room+"/close",owner.cookie,{})).status).toBe(404);
  expect((await call(room+"/close",member.cookie,{})).status).toBe(200);
});

it("lets a new address verify through a group link without granting membership until approval", async () => {
  const owner = await login("owner@example.test");
  const id = uuid(), room = "rooms/" + id;
  await call("rooms", owner.cookie, { id, kind: "group", title: "Guest group" });
  const link = await call(room + "/moderate", owner.cookie, { action: "ensureLink" });
  const { token } = await link.json<{ token: string }>();
  const guest = await login("link-guest@example.test", token);

  expect((await call(room, guest.cookie)).status).toBe(404);
  expect(await (await call("join", guest.cookie, { token })).json()).toEqual({ id, state: "requested" });
  expect((await call(room, guest.cookie)).status).toBe(404);
  expect((await call(room + "/moderate", owner.cookie, { action: "approve", person: guest.id })).status).toBe(200);
  expect((await call(room, guest.cookie)).status).toBe(200);
});

it("lets members invite only their bots and only managers remove them, even during a discussion", async () => {
  const a=await login("owner@example.test"), b=await login("member@example.test");
  const id=uuid(), first=uuid(), second=uuid(), room="rooms/"+id;
  const cmd=(who:typeof a,action:string,fields={})=>call(room+"/bots",who.cookie,{action,...fields});
  await call("rooms",a.cookie,{id,kind:"group",title:"Peer discussion"});
  await call(room+"/invite",a.cookie,{email:b.email});await call(room+"/accept",b.cookie,{});
  expect((await cmd(a,"invite",{owner:a.id,bot:first,name:"Planner"})).status).toBe(200);
  expect((await cmd(b,"invite",{owner:a.id,bot:first,name:"Other"})).status).toBe(403);
  expect((await cmd(b,"invite",{owner:b.id,bot:first,name:"Other"})).status).toBe(409);
  expect((await cmd(b,"invite",{owner:b.id,bot:second,name:"Reviewer"})).status).toBe(200);
  expect((await cmd(b,"remove",{bot:second})).status).toBe(409);
  const start=async()=>{
    const round=uuid();
    expect((await cmd(b,"start",{round,first,second,topic:"Compare two approaches",locale:"vi"})).status).toBe(200);
    return round;
  };
  await call(room+"/moderate",a.cookie,{action:"mute",person:b.id});
  expect((await cmd(a,"start",{round:uuid(),first,second,topic:"Muted bot owner",locale:"en"})).ok).toBe(false);
  await call(room+"/moderate",a.cookie,{action:"unmute",person:b.id});
  const round=await start();
  const late=await login("third@example.test");
  await call(room+"/invite",a.cookie,{email:late.email});
  await call(room+"/accept",late.cookie,{});
  expect(await (await call(room+"/bots",late.cookie)).json()).toMatchObject({round:{topic:null}});
  expect(await (await call(room+"/bots",a.cookie)).json()).toMatchObject({round:{topic:"Compare two approaches"}});
  expect(await (await call("bot-turns",b.cookie)).json()).toEqual({jobs:[]});
  expect(await (await call("bot-turns",a.cookie)).json()).toEqual({jobs:[{bot:first,room:id}]});
  const claim=async(who:typeof a,bot:string)=>(await cmd(who,"claim",{bot})).json<{job:null|{claim:string;prior:string|null}}>();
  const one=(await claim(a,first)).job!;
  expect(one.prior).toBeNull();expect((await claim(a,first)).job).toBeNull();
  const reply={round,bot:first,claim:one.claim,text:"First suggestion"};
  expect((await cmd(b,"reply",reply)).ok).toBe(false);expect((await cmd(a,"reply",reply)).ok).toBe(true);
  expect((await cmd(a,"reply",reply)).ok).toBe(false);
  const two=(await claim(b,second)).job!;
  expect(two.prior).toBe("First suggestion");
  expect((await cmd(b,"reply",{round,bot:second,claim:two.claim,text:"I agree with the first suggestion"})).ok).toBe(true);
  expect(await (await call("bot-turns",a.cookie)).json()).toEqual({jobs:[]});
  expect(await (await call(room,a.cookie)).json()).toMatchObject({posts:[{body:"Compare two approaches"},{botName:"Planner",author:a.email},{botName:"Reviewer",author:b.email}]});
  const withdrawn=await start();
  const claimed=(await claim(a,first)).job!;
  const {posts}=await (await call(room,b.cookie)).json<{posts:{seq:number}[]}>();
  await call(room+"/moderate",b.cookie,{action:"deletePost",seq:posts.at(-1)!.seq});
  expect((await cmd(a,"reply",{round:withdrawn,bot:first,claim:claimed.claim,text:"Withdrawn topic"})).ok).toBe(false);
  const other=await start();const inFlight=(await claim(a,first)).job!;
  await call(room+"/moderate",a.cookie,{action:"promote",person:b.id});
  expect((await cmd(b,"remove",{bot:first})).ok).toBe(true);
  expect((await cmd(a,"reply",{round:other,bot:first,claim:inFlight.claim,text:"Late reply"})).ok).toBe(false);
});

it("offers only the caller's registered bots for groups where they can post", async () => {
  const owner = await login("owner@example.test");
  const member = await login("member@example.test");
  const outsider = await login("third@example.test");
  const source = uuid(), destination = uuid();
  const ownerBot = uuid(), memberBot = uuid();
  const room = "rooms/" + destination;
  const available = async (who: typeof owner) =>
    (await call(room + "/bots?available=1", who.cookie)).json();
  const add = (who: typeof owner, bot: string) =>
    call(room + "/bots", who.cookie, { action: "add", bot });

  for (const id of [source, destination]) {
    await call("rooms", owner.cookie, { id, kind: "group", title: "Test group" });
    await call("rooms/" + id + "/invite", owner.cookie, { email: member.email });
    await call("rooms/" + id + "/accept", member.cookie, {});
  }
  for (const [who, bot, name] of [[owner, ownerBot, "Planner"], [member, memberBot, "Reviewer"]] as const) {
    expect((await call("rooms/" + source + "/bots", who.cookie, {
      action: "invite", owner: who.id, bot, name,
    })).status).toBe(200);
  }

  expect(await available(owner)).toEqual({ bots: [{ id: ownerBot, name: "Planner" }] });
  expect(await available(member)).toEqual({ bots: [{ id: memberBot, name: "Reviewer" }] });
  expect(await available(outsider)).toEqual({ bots: [] });
  expect((await add(member, ownerBot)).status).toBe(409);
  expect((await call(room + "/moderate", owner.cookie, { action: "mute", person: member.id })).status).toBe(200);
  expect(await available(member)).toEqual({ bots: [] });
  expect((await add(member, memberBot)).status).toBe(409);

  expect((await add(owner, ownerBot)).status).toBe(200);
  expect(await available(owner)).toEqual({ bots: [] });
  expect(await (await call(room + "/bots", member.cookie)).json()).toMatchObject({
    bots: [{ id: ownerBot, name: "Planner", owner: owner.email }],
  });
});

async function signedBotClaim(who: Awaited<ReturnType<typeof login>>, room: string, bot: string, pair: CryptoKeyPair) {
  const challenge = await call(`rooms/${room}/bots`, who.cookie, { action: "challenge", owner: who.id, bot });
  expect(challenge.status).toBe(200);
  const { nonce } = await challenge.json<{ nonce: string }>();
  const key = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(botClaimBytes({ origin, owner: who.id, bot, room, nonce }))));
  const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return { username: await proofUsername(key), proof: { nonce, publicKey: hex(key), signature: hex(signature) } };
}
const botKey = () => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);

it("routes desktop owned-bot challenge and signed invite through the real worker", async () => {
  const owner = await login("owner@example.test"), room = uuid(), bot = uuid();
  expect((await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" })).status).toBe(200);
  const claims = createPersonalInboxClaims(async (path: string, body: unknown) => {
    const response = await call(path, owner.cookie, body);
    if (!response.ok) throw new Error(`fixture_http_${response.status}`);
    return response.json();
  });
  const { nonce } = await claims.challenge({ room, owner: owner.id, bot });
  const pair = await botKey();
  const key = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(botClaimBytes({ origin, owner: owner.id, bot, room, nonce }))));
  const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const username = await proofUsername(key);
  const request = { room, owner: owner.id, bot, name: "Fixture", username, proof: { nonce, publicKey: hex(key), signature: hex(signature) } };
  expect(await claims.invite(request)).toEqual({ ok: true });
  expect(await (await call(`rooms/${room}/bots`, owner.cookie)).json()).toMatchObject({ bots: [{ id: bot, username }] });
  await expect(claims.invite(request)).rejects.toThrow("fixture_http_409");
});

it("keeps bot usernames unique and owner-bound when inviting to groups", async () => {
  const owner = await login("owner@example.test"), member = await login("member@example.test");
  const roomId = uuid(), otherRoom = uuid(), bot = uuid(), otherBot = uuid();
  for (const id of [roomId, otherRoom]) {
    await call("rooms", owner.cookie, { id, kind: "group", title: "Fixture" });
    await call(`rooms/${id}/invite`, owner.cookie, { email: member.email });
    await call(`rooms/${id}/accept`, member.cookie, {});
  }
  const key = await botKey(), differentKey = await botKey();
  const original = await signedBotClaim(owner, roomId, bot, key), username = original.username;
  const invite = (who: typeof owner, room: string, botId: string, claim: Awaited<ReturnType<typeof signedBotClaim>>, name = "Fixture") =>
    call(`rooms/${room}/bots`, who.cookie, { action: "invite", owner: who.id, bot: botId, name, ...claim });
  expect((await invite(owner, roomId, bot, original)).status).toBe(200);
  expect((await invite(owner, roomId, bot, original)).status).toBe(409);
  const attacker = await signedBotClaim(member, roomId, otherBot, differentKey);
  expect((await invite(member, roomId, otherBot, { ...attacker, username })).status).toBe(403);
  expect((await invite(member, otherRoom, bot, await signedBotClaim(member, otherRoom, bot, key))).status).toBe(409);
  expect((await invite(owner, otherRoom, bot, await signedBotClaim(owner, otherRoom, bot, differentKey), "Changed")).status).toBe(409);
  expect(await (await call(`rooms/${roomId}/bots`, member.cookie)).json()).toMatchObject({ bots: [{ id: bot, name: "Fixture", username, owner: owner.email }] });
  expect(await (await call(`rooms/${otherRoom}/bots?available=1`, owner.cookie)).json()).toEqual({ bots: [{ id: bot, name: "Fixture", username }] });
  expect((await call(`rooms/${otherRoom}/bots`, member.cookie, { action: "add", bot })).status).toBe(409);
});

it("allows existing bots at the registration limit without allowing a new bot", async () => {
  const owner = await login("owner@example.test"), room = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  const ids = Array.from({ length: 50 }, () => uuid());
  await env.INBOX_DB.batch(ids.map(id => env.INBOX_DB.prepare("INSERT INTO inbox_bots(id,owner,name) VALUES (?,?,?)").bind(id, owner.id, "Fixture")));
  const key = await botKey();
  const invite = (bot: string, claim?: Awaited<ReturnType<typeof signedBotClaim>>) => call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot, name: "Fixture", ...claim });
  expect((await invite(ids[0]!)).status).toBe(200);
  expect((await invite(ids[1]!, await signedBotClaim(owner, room, ids[1]!, key))).status).toBe(200);
  const newBot = uuid();
  expect((await invite(newBot, await signedBotClaim(owner, room, newBot, await botKey()))).status).toBe(409);
});

it("registers at most one bot when two owners concurrently claim a username", async () => {
  const a = await login("owner@example.test"), b = await login("member@example.test"), room = uuid();
  await call("rooms", a.cookie, { id: room, kind: "group", title: "Fixture" });
  await call(`rooms/${room}/invite`, a.cookie, { email: b.email });
  await call(`rooms/${room}/accept`, b.cookie, {});
  const key = await botKey(), aBot = uuid(), bBot = uuid();
  const [aClaim, bClaim] = await Promise.all([signedBotClaim(a, room, aBot, key), signedBotClaim(b, room, bBot, key)]);
  const responses = await Promise.all([call(`rooms/${room}/bots`, a.cookie, { action: "invite", owner: a.id, bot: aBot, name: "Fixture", ...aClaim }), call(`rooms/${room}/bots`, b.cookie, { action: "invite", owner: b.id, bot: bBot, name: "Fixture", ...bClaim })]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
});

it("consumes a signed bot claim once and rejects expired or cross-room proofs", async () => {
  const owner = await login("owner@example.test"), room = uuid(), otherRoom = uuid(), bot = uuid(), key = await botKey();
  for (const id of [room, otherRoom]) await call("rooms", owner.cookie, { id, kind: "group", title: "Fixture" });
  const claim = await signedBotClaim(owner, room, bot, key);
  const input = { action: "invite", owner: owner.id, bot, name: "Fixture", ...claim };
  expect((await call(`rooms/${otherRoom}/bots`, owner.cookie, input)).status).toBe(409);
  const results = await Promise.all([call(`rooms/${room}/bots`, owner.cookie, input), call(`rooms/${room}/bots`, owner.cookie, input)]);
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
  expect(await (await call(`rooms/${room}/bots`, owner.cookie)).json()).toMatchObject({ bots: [{ id: bot, username: claim.username }] });
  const expiredBot = uuid(), expired = await signedBotClaim(owner, room, expiredBot, await botKey());
  await env.INBOX_DB.prepare("UPDATE inbox_bot_claims SET expires=0 WHERE nonce=?").bind(expired.proof.nonce).run();
  expect((await call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot: expiredBot, name: "Fixture", ...expired })).status).toBe(409);
  expect(await env.INBOX_DB.prepare("SELECT id FROM inbox_bots WHERE id=?").bind(expiredBot).first()).toBeNull();
});

it("retries an invitation after a lost response without creating a second bot or membership", async () => {
  const owner = await login("owner@example.test"), room = uuid(), bot = uuid(), key = await botKey();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  const first = await signedBotClaim(owner, room, bot, key);
  expect((await call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot, name: "Fixture", ...first })).status).toBe(200);
  const retry = await signedBotClaim(owner, room, bot, key);
  expect((await call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot, name: "Fixture", ...retry })).status).toBe(200);
  expect(await env.INBOX_DB.prepare("SELECT count(*) AS n FROM inbox_bots WHERE id=?").bind(bot).first()).toEqual({ n: 1 });
  expect(await env.INBOX_DB.prepare("SELECT count(*) AS n FROM inbox_room_bots WHERE room=? AND bot=?").bind(room, bot).first()).toEqual({ n: 1 });
});

it("rate limits attempts to register bot claims", async () => {
  const owner = await login("owner@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  const input = { action: "invite", owner: owner.id, bot, name: "Fixture", username: `bot_k${"0".repeat(64)}`, proof: { nonce: uuid(), publicKey: "0".repeat(64), signature: "0".repeat(128) } };
  for (let index = 0; index < 30; index++) expect((await call(`rooms/${room}/bots`, owner.cookie, input)).status).toBe(409);
  expect((await call(`rooms/${room}/bots`, owner.cookie, input)).status).toBe(429);
});

it("deletes outstanding bot challenges when their group is deleted", async () => {
  const owner = await login("owner@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  const claim = await signedBotClaim(owner, room, bot, await botKey());
  await env.INBOX_DB.prepare("DELETE FROM inbox_rooms WHERE id=?").bind(room).run();
  expect(await env.INBOX_DB.prepare("SELECT nonce FROM inbox_bot_claims WHERE nonce=?").bind(claim.proof.nonce).first()).toBeNull();
});

it("deletes outstanding bot challenges when their owner account is deleted", async () => {
  const owner = await login("owner@example.test"), member = await login("member@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  await call(`rooms/${room}/invite`, owner.cookie, { email: member.email });
  await call(`rooms/${room}/accept`, member.cookie, {});
  const claim = await signedBotClaim(member, room, bot, await botKey());
  await env.INBOX_DB.prepare('DELETE FROM "user" WHERE id=?').bind(member.id).run();
  expect(await env.INBOX_DB.prepare("SELECT nonce FROM inbox_bot_claims WHERE nonce=?").bind(claim.proof.nonce).first()).toBeNull();
});

it("rejects a signed claim after the owner loses group permission", async () => {
  const owner = await login("owner@example.test"), member = await login("member@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  await call(`rooms/${room}/invite`, owner.cookie, { email: member.email });
  await call(`rooms/${room}/accept`, member.cookie, {});
  const claim = await signedBotClaim(member, room, bot, await botKey());
  await call(`rooms/${room}/moderate`, owner.cookie, { action: "mute", person: member.id });
  expect((await call(`rooms/${room}/bots`, member.cookie, { action: "invite", owner: member.id, bot, name: "Fixture", ...claim })).status).toBe(409);
  expect(await env.INBOX_DB.prepare("SELECT id FROM inbox_bots WHERE id=?").bind(bot).first()).toBeNull();
});

it("cleans expired challenges during scheduled maintenance", async () => {
  const owner = await login("owner@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  const claim = await signedBotClaim(owner, room, bot, await botKey());
  await env.INBOX_DB.prepare("UPDATE inbox_bot_claims SET expires=0 WHERE nonce=?").bind(claim.proof.nonce).run();
  await worker.scheduled(createScheduledController(), testEnv);
  expect(await env.INBOX_DB.prepare("SELECT nonce FROM inbox_bot_claims WHERE nonce=?").bind(claim.proof.nonce).first()).toBeNull();
});

it("does not notify a group merely for issuing a bot challenge", async () => {
  const owner = await login("owner@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  let notifications = 0;
  const SIGNALS = { getByName: () => ({ notify: async () => { notifications++; } }) } as unknown as InboxEnv["SIGNALS"];
  const challenge = await call(`rooms/${room}/bots`, owner.cookie, { action: "challenge", owner: owner.id, bot }, { SIGNALS });
  expect(challenge.status).toBe(200);
  expect(challenge.headers.has("x-inbox-internal-silent")).toBe(false);
  expect(notifications).toBe(0);
  expect((await call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot, name: "Fixture" }, { SIGNALS })).status).toBe(200);
  expect(notifications).toBe(1);
});

it("adds a username to a legacy bot already in the target group", async () => {
  const owner = await login("owner@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  const input = { action: "invite", owner: owner.id, bot, name: "Fixture" };
  expect((await call(`rooms/${room}/bots`, owner.cookie, input)).status).toBe(200);
  const key = await botKey(), claim = await signedBotClaim(owner, room, bot, key);
  expect((await call(`rooms/${room}/bots`, owner.cookie, { ...input, ...claim })).status).toBe(200);
  expect(await env.INBOX_DB.prepare("SELECT username FROM inbox_bots WHERE id=?").bind(bot).first()).toEqual({ username: claim.username });
  const [retryA, retryB] = await Promise.all([signedBotClaim(owner, room, bot, key), signedBotClaim(owner, room, bot, key)]);
  const retries = await Promise.all([call(`rooms/${room}/bots`, owner.cookie, { ...input, ...retryA }), call(`rooms/${room}/bots`, owner.cookie, { ...input, ...retryB })]);
  expect(retries.map(response => response.status)).toEqual([200, 200]);
});

it("does not update a bot when its owner is muted in the group", async () => {
  const owner = await login("owner@example.test"), member = await login("member@example.test"), room = uuid(), bot = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  await call(`rooms/${room}/invite`, owner.cookie, { email: member.email });
  await call(`rooms/${room}/accept`, member.cookie, {});
  const input = { action: "invite", owner: member.id, bot, name: "Fixture" };
  expect((await call(`rooms/${room}/bots`, member.cookie, input)).status).toBe(200);
  await call(`rooms/${room}/moderate`, owner.cookie, { action: "mute", person: member.id });
  expect((await call(`rooms/${room}/bots`, member.cookie, { action: "challenge", owner: member.id, bot })).status).toBe(409);
  expect(await env.INBOX_DB.prepare("SELECT username FROM inbox_bots WHERE id=?").bind(bot).first()).toEqual({ username: null });
});

it("does not register a new username when the group is full", async () => {
  const owner = await login("owner@example.test"), room = uuid();
  await call("rooms", owner.cookie, { id: room, kind: "group", title: "Fixture" });
  const existing = uuid();
  for (let index = 0; index < 12; index++) {
    expect((await call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot: index === 0 ? existing : uuid(), name: "Fixture" })).status).toBe(200);
  }
  expect((await call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot: existing, name: "Fixture", ...await signedBotClaim(owner, room, existing, await botKey()) })).status).toBe(200);
  const bot = uuid();
  expect((await call(`rooms/${room}/bots`, owner.cookie, { action: "invite", owner: owner.id, bot, name: "Fixture", ...await signedBotClaim(owner, room, bot, await botKey()) })).status).toBe(409);
  expect(await env.INBOX_DB.prepare("SELECT id FROM inbox_bots WHERE id=?").bind(bot).first()).toBeNull();
});

it("keeps explicit email-update choices with the verified account across devices", async () => {
  const email = "a@example.test";
  const { cookie: first } = await login(email);
  const { cookie: second } = await login(email);
  const { cookie: peer } = await login("b@example.test");
  const route = "account/updates";
  expect((await call(route)).status).toBe(401);
  expect(await (await call(route, first)).json()).toEqual({ email, enabled: null });
  expect((await call(route, peer, { email, enabled: false })).status).toBe(409);
  expect((await call(route, first, { email, enabled: false })).status).toBe(200);
  expect(await (await call(route, second, { email, enabled: true, initial: true })).json()).toEqual({ email, enabled: false });
  expect(await (await call(route, second, { email, enabled: true })).json()).toEqual({ email, enabled: true });
  expect(await (await call(route, peer)).json()).toEqual({ email: "b@example.test", enabled: null });
});
