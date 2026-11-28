import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Ledger } from "../../apps/ai-pilot/ledger.mjs";
import { startMobileFixture } from "./mobile-chat-fixture.mjs";

let f, cookie, thread;
const message = (extra = {}) => ({ account:"alice", id:randomUUID(), thread, prompt:"Xin chào", save:true, ...extra });
beforeEach(async () => {
  f = await startMobileFixture();
  f.grant("alice");
  cookie = await f.login("alice");
  thread = randomUUID();
});
afterEach(async () => f.close());

it("enters chat with an email code, requires a verified account and invalidates the bearer on logout", async () => {
  expect((await f.call("/threads")).status).toBe(401);
  expect((await f.call("/threads", cookie)).status).toBe(200);
  expect((await f.call("/login", null, { email:"alice@example.test", otp:"12345678" })).status).toBe(401);
  const member = [...f.tokens.values()][0];
  member.emailVerified = false;
  expect((await f.call("/threads", cookie)).status).toBe(401);
  member.emailVerified = true;
  expect((await f.call("/logout", cookie, {})).status).toBe(200);
  expect((await f.call("/threads", cookie)).status).toBe(401);
});

it("preserves authentication during an account service outage", async () => {
  f.behavior.authOffline = true;
  expect((await f.call("/threads", cookie)).status).toBe(503);
  f.behavior.authOffline = false;
  expect((await f.call("/threads", cookie)).status).toBe(200);
});

it("requires explicit saving, same-origin requests and funded entitlement before inference", async () => {
  const newcomer = await f.login("newuser");
  expect((await f.call("/send", newcomer, message({ account:"newuser" }))).status).toBe(402);
  expect((await f.call("/send", cookie, message({ save:false }))).status).toBe(400);
  expect((await f.call("/send", cookie, message(), { headers:{ origin:"https://other.example.test" } })).status).toBe(403);
  expect(f.generations).toHaveLength(0);
});

it("delivers the first delta before completion, settles once, restores history and cascades deletion", async () => {
  f.behavior.delay = 200;
  const body = message();
  const response = await f.call("/send", cookie, body);
  expect(response.status).toBe(200);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  expect((await reader.read()).value).toContain("Xin ");
  expect(f.ledger.db.prepare("SELECT state FROM requests WHERE id=?").get(body.id).state).toBe("held");
  let stream = "";
  for (;;) { const part = await reader.read(); if (part.done) break; stream += part.value; }
  expect(stream).toContain('"state":"complete"');
  expect((await f.call("/send", cookie, body)).status).toBe(409);
  expect(f.generations).toHaveLength(1);
  const second = await f.login("alice");
  const scope = { account:"alice", thread };
  expect((await (await f.call("/history", second, scope)).json()).turns[0]).toMatchObject({ answer:"Xin chào", state:"complete" });
  expect((await f.call("/rename", second, { ...scope, title:"Tài liệu" })).status).toBe(200);
  expect((await (await f.call("/threads", cookie)).json()).threads[0].title).toBe("Tài liệu");
  expect((await f.call("/delete", second, scope)).status).toBe(200);
  expect((await f.call("/history", cookie, scope)).status).toBe(404);
  expect(f.ledger.db.prepare("SELECT count(*) n FROM mobile_turns").get().n).toBe(0);
});

it("isolates account switches and never puts other conversations or device credentials into the prompt", async () => {
  await (await f.call("/send", cookie, message({ prompt:"thread one private" }))).text();
  const bob = await f.login("bob");
  for (const op of ["history", "delete", "rename"]) {
    expect((await f.call("/" + op, bob, { account:"bob", thread, title:"X" })).status).toBe(404);
    expect((await f.call("/" + op, bob, { account:"alice", thread })).status).toBe(409);
  }
  expect((await (await f.call("/threads", bob)).json()).threads).toEqual([]);
  await (await f.call("/send", cookie, message({ thread:randomUUID() }))).text();
  const upstream = f.generations.at(-1);
  expect(upstream.tools).toBeUndefined();
  expect(JSON.stringify(upstream)).not.toContain("thread one private");
  expect(JSON.stringify(upstream)).not.toContain(cookie);
});

it("directs desktop work to pairing without enqueueing, charging or claiming completion", async () => {
  for (const options of [{ prompt:"Mở MISA trên máy tính và đối chiếu sổ sách." }, { runtime:"desktop" }]) {
    const res = await f.call("/send", cookie, message(options));
    expect((await res.json()).error.code).toBe("desktop_required");
  }
  expect(f.generations).toHaveLength(0);
});

it("holds ambiguous charges across reopen and frees the concurrency slot on truncated streams", async () => {
  f.config.managedLimits.concurrent = 1;
  f.save();
  f.behavior.disconnect = true;
  const body = message();
  expect(await (await f.call("/send", cookie, body)).text()).toContain("interrupted");
  const reopened = new Ledger(f.file);
  try {
    expect(reopened.db.prepare("SELECT state,generation FROM requests WHERE id=?").get(body.id)).toMatchObject({ state:"held", generation:expect.stringMatching(/^gen-/) });
    expect(reopened.db.prepare("SELECT state FROM mobile_turns WHERE id=?").get(body.id).state).toBe("interrupted");
  } finally { reopened.db.close(); }
  f.behavior.disconnect = false;
  expect(await (await f.call("/send", cookie, message())).text()).toContain('"state":"complete"');
});

it("keeps simultaneous accounts within one global monetary ceiling and reloads the kill switch", async () => {
  f.grant("bob");
  const bob = await f.login("bob");
  f.config.managedLimits.dailyMicros = 11500;
  f.save();
  f.behavior.delay = 100;
  const attempts = await Promise.all([f.call("/send", cookie, message()), f.call("/send", bob, message({ account:"bob" }))]);
  expect(attempts.map(r => r.status).sort()).toEqual([200,429]);
  await Promise.all(attempts.map(r => r.text()));
  f.config.managedLimits.enabled = false;
  f.save();
  expect((await f.call("/send", cookie, message())).status).toBe(503);
  expect(f.generations).toHaveLength(1);
});

it("enforces account rate limits, administrative suspension and capped responses", async () => {
  f.behavior.finish = "length";
  f.config.managedLimits.requestsPerMinute = 1;
  f.save();
  expect(await (await f.call("/send", cookie, message())).text()).toContain('"state":"limited"');
  expect((await f.call("/send", cookie, message())).status).toBe(429);
  f.ledger.db.prepare("INSERT INTO managed_suspensions VALUES (?)").run("alice");
  expect((await f.call("/send", cookie, message())).status).toBe(403);
  expect(f.generations).toHaveLength(1);
});


it("stops a live generation while preserving its unresolved charge, then admits another turn", async () => {
  f.behavior.delay = 2000;
  const ctl = new AbortController(), id = randomUUID();
  const response = await f.call("/send", cookie, message({ id }), { signal:ctl.signal });
  const reader = response.body.getReader();
  expect((await reader.read()).value.length).toBeGreaterThan(0);
  ctl.abort();
  await expect.poll(() => f.ledger.db.prepare("SELECT state FROM mobile_turns WHERE id=?").get(id).state).toBe("interrupted");
  expect(f.ledger.db.prepare("SELECT state FROM requests WHERE id=?").get(id).state).toBe("held");
  expect(f.ledger.db.prepare("SELECT count(*) n FROM active_requests").get().n).toBe(0);
  f.behavior.delay = 1;
  expect(await (await f.call("/send", cookie, message())).text()).toContain('"state":"complete"');
});

it("offers only allowlisted text skills and keeps the context window bounded", async () => {
  expect((await f.call("/send", cookie, message({ skill:"unknown" }))).status).toBe(400);
  for (let n = 0; n < 4; n++)
    expect((await (await f.call("/send", cookie, message({ skill:"translate", prompt:String(n).repeat(6000) }))).text())).toContain("complete");
  const last = f.generations.at(-1);
  expect(last.messages[0].content).toContain("Translate only");
  expect(last.messages.length).toBe(4);
  expect(last.tools).toBeUndefined();
});

it("leaves a cancelled request unsent while the issuer is verifying its session", async () => {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  f.behavior.beforeMe = () => { started.resolve(); return release.promise; };
  const ctl = new AbortController();
  const result = f.call("/send", cookie, message(), { signal:ctl.signal }).catch(error => error.name);
  await started.promise;
  ctl.abort();
  expect(await result).toBe("AbortError");
  await new Promise(resolve => setTimeout(resolve, 30));
  release.resolve();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(f.generations).toHaveLength(0);
  expect(f.ledger.db.prepare("SELECT count(*) n FROM requests").get().n).toBe(0);
});

it("admits a verified new account once within an explicitly funded trial cohort", async () => {
  f.config.mobileTrial = { creditMicros:30000, maxAccounts:1, days:2 };
  f.save();
  const trial = await f.login("trial"), late = await f.login("late");
  expect(await (await f.call("/send", trial, message({ account:"trial" }))).text()).toContain("complete");
  expect((await f.call("/send", late, message({ account:"late" }))).status).toBe(402);
  expect(await (await f.call("/send", trial, message({ account:"trial" }))).text()).toContain("complete");
  expect(f.ledger.summary("trial").included).toBe(29800);
  expect(f.ledger.order("trial","monthly",f.config,randomUUID()).state).toBe("pending");
  expect(f.ledger.db.prepare("SELECT count(*) n FROM orders WHERE sku='mobile_trial'").get().n).toBe(1);
});
