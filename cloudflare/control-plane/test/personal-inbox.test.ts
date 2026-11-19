import { brotliCompressSync, gzipSync } from "node:zlib";
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
  await env.INBOX_DB.prepare(
    "INSERT INTO inbox_files(room,author,nonce,name,digest,bytes,created) VALUES (?,?,?,?,?,?,?)",
  ).bind(id, a.id, uuid(), "legacy.txt", "fixture", new Uint8Array([68,49]).buffer, Date.now()).run();
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
