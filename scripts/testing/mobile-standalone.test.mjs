import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { invite } from "../../apps/ai-pilot/accounts.mjs";
import { digest, Ledger } from "../../apps/ai-pilot/ledger.mjs";
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
  expect(f.tokens.size).toBe(0);
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

it("uses only reviewed text instructions from the bundled campaign and outreach skills", async () => {
  for (const [skill, expected] of [["campaign-plan","Campaign Brief Structure"],["draft-outreach","Relevance line"]]) {
    const response = await f.call("/send", cookie, message({ skill }));
    expect(await response.text()).toContain("complete");
    const request = f.generations.at(-1);
    expect(request.messages[0].content).toContain(expected);
    expect(request.messages[0].content).not.toContain("Step 4 - Create the draft");
    expect(request.tools).toBeUndefined();
  }
});

it("lists the signed-in owner's registered computer labels without granting computer access", async () => {
  expect((await (await f.call("/devices",cookie,{account:"alice"})).json()).devices)
    .toEqual([{ name:"alice laptop", platform:"darwin", appVersion:"1.0.0" }]);
  expect((await f.call("/devices", cookie, {account:"bob"})).status).toBe(409);
  expect((await f.call("/devices", null, {account:"alice"})).status).toBe(401);
});

it("pages older turns once with deterministic ordering for identical timestamps", async () => {
  const db = f.ledger.db, stamp = Date.now(), ids = Array.from({length:15}, () => randomUUID()).sort();
  db.prepare("INSERT INTO mobile_threads VALUES (?,?,?,?)").run("alice",thread,"History",stamp);
  for (const id of ids) db.prepare("INSERT INTO mobile_turns VALUES (?,?,?,?,?,?,?)").run("alice",thread,id,"q","a","complete",stamp);
  const scope = {account:"alice",thread};
  const first = await (await f.call("/history",cookie,scope)).json();
  const older = await (await f.call("/history",cookie,{...scope,before:first.next})).json();
  expect(first.turns).toHaveLength(12);
  expect(older.next).toBe(null);
  expect([...older.turns,...first.turns].map(r => r.id)).toEqual(ids);
});

it("lists redacted sessions and revokes one or all at the issuer without affecting another account", async () => {
  const second = await f.login("alice"), bob = await f.login("bob");
  const scope = { account:"alice" };
  const sessions = (await (await f.call("/sessions", cookie, scope)).json()).sessions;
  expect(sessions).toHaveLength(2);
  for (const view of sessions) expect(Object.keys(view).sort()).toEqual(["createdAt","current","expiresAt","id"]);
  expect(sessions.map(s => s.current)).toEqual([true,false]);
  const foreign = (await (await f.call("/sessions", bob, { account:"bob" })).json()).sessions[0];
  expect((await f.call("/sessions/revoke", cookie, { ...scope, sessionId:foreign.id })).status).toBe(404);
  expect((await f.call("/sessions/revoke", cookie, { ...scope, sessionId:sessions[1].id })).status).toBe(200);
  expect((await f.call("/threads", second)).status).toBe(401);
  const third = await f.login("alice");
  const walletToken = "sbpilot_session_" + randomUUID();
  f.ledger.db.prepare("INSERT INTO wallet_sessions VALUES (?,?,?)").run(digest(walletToken),"alice",Date.now()+60000);
  expect(f.ledger.authenticate(walletToken, true)).toBe("alice");
  f.behavior.authOffline = true;
  expect((await f.call("/sessions/logout-all", cookie, scope)).status).toBe(503);
  f.behavior.authOffline = false;
  expect((await f.call("/sessions/logout-all", cookie, { account:"bob" })).status).toBe(409);
  expect((await f.call("/sessions/logout-all", cookie, scope)).status).toBe(200);
  expect(() => f.ledger.authenticate(walletToken, true)).toThrow();
  for (const handle of [third,cookie]) expect((await f.call("/threads", handle)).status).toBe(401);
  expect((await f.call("/threads", bob)).status).toBe(200);
});

it("pauses skills, denies unbound runtime requests and reports account credit without acquiring a trial", async () => {
  const before = f.generations.length;
  f.config.disabledMobileSkills = ["translate"];
  f.save();
  for (const runtime of ["cloud","local","document","future"]) {
    expect((await f.call("/send", cookie, message({ runtime }))).status).toBe(409);
  }
  expect((await f.call("/send", cookie, message({ skill:"translate" }))).status).toBe(409);
  const usage = await (await f.call("/account-usage", cookie, { account:"alice" })).json();
  expect(usage.available).toBeGreaterThan(0);
  expect(usage.byokTodayUTC).toEqual({ settled:0, pending:0 });
  expect((await f.call("/account-usage", cookie, { account:"bob" })).status).toBe(409);
  expect(f.generations).toHaveLength(before);
  f.config.mobileTrial = { creditMicros:30000, days:2, maxAccounts:3 };
  f.save();
  const bob = await f.login("bob");
  expect((await (await f.call("/account-usage", bob, { account:"bob" })).json()).available).toBe(0);
  await (await f.call("/send", bob, message({ account:"bob" }))).text();
  expect(f.generations).toHaveLength(before+1);
  f.config.managedLimits.trialPaused = true;
  f.save();
  expect((await f.call("/send", bob, message({ account:"bob" }))).status).toBe(402);
  expect((await (await f.call("/account-usage", bob, { account:"bob" })).json()).available).toBe(0);
  const paid = await f.call("/send", cookie, message());
  expect(paid.status).toBe(200);
  await paid.text();
});

it("does not issue a wallet session from a verification that overlapped logout everywhere", async () => {
  const email = "alice@example.test";
  invite(f.ledger, "alice", email);
  await f.call("/code", null, { email });
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  f.behavior.beforeMe = async () => {
    f.behavior.beforeMe = undefined;
    started.resolve();
    await release.promise;
  };
  const verifying = fetch(f.url + "/wallet/verify-code", { method:"POST",
    headers:{ "content-type":"application/json" }, body:JSON.stringify({ email, otp:"12345678" }) });
  await started.promise;
  try {
    expect((await f.call("/sessions/logout-all", cookie, { account:"alice" })).status).toBe(200);
  } finally { release.resolve(); }
  expect((await verifying).status).toBe(401);
  expect(f.ledger.db.prepare("SELECT count(*) AS n FROM wallet_sessions WHERE owner='alice'").get().n).toBe(0);
});
