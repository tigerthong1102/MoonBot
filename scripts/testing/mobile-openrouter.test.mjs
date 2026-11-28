import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { startMobileFixture } from "./mobile-chat-fixture.mjs";

let f, cookie, thread;
const account = "personal";
const post = (path, body = {}, session = cookie) => f.call(path, session, { account, ...body });
const send = (provider = "openrouter") => post("/send", { thread, id:randomUUID(), prompt:"translate hello", save:true, provider });
const begin = async () => new URL((await (await post("/provider/start")).json()).url);
const complete = (url, session = cookie) => post("/provider/complete", { state:url.searchParams.get("state"), code:"fixture-code" }, session);
beforeEach(async () => {
  f = await startMobileFixture();
  cookie = await f.login(account);
  thread = randomUUID();
});
afterEach(async () => f.close());

it("hides unconfigured connections and requires the original mobile session and S256 challenge", async () => {
  expect((await post("/provider/start")).status).toBe(404);
  f.settings.openRouterOAuth = true;
  const url = await begin();
  expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
  expect(url.searchParams.get("callback_url")).toBe(f.settings.mobileOrigin + "/mobile/callback");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const second = await f.login(account);
  expect((await complete(url, second)).status).toBe(409);
  expect((await complete(url)).status).toBe(200);
  expect(createHash("sha256").update(f.behavior.exchange.code_verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
  expect((await complete(url)).status).toBe(409);
  const info = await (await f.call("/threads", cookie)).json();
  expect(info.provider.connected).toBe(true);
  expect(JSON.stringify(info)).not.toContain(f.behavior.personalKey);
  expect(Buffer.from(f.ledger.db.prepare("SELECT sealed FROM mobile_provider_keys").get().sealed).includes(Buffer.from(f.behavior.personalKey))).toBe(false);
});

it("charges the user's key with no managed entitlement and pins the payer even after disconnect", async () => {
  f.settings.openRouterOAuth = true;
  await complete(await begin());
  expect(await (await send()).text()).toContain('"state":"complete"');
  expect(f.behavior.chatKeys).toEqual(["Bearer " + f.behavior.personalKey]);
  expect(f.behavior.keyCalls).toBe(0);
  expect(f.ledger.db.prepare("SELECT count(*) n FROM requests").get().n).toBe(0);
  expect(f.ledger.db.prepare("SELECT cost FROM mobile_byok_usage").get().cost).toBe(100);
  expect((await post("/provider/disconnect")).status).toBe(200);
  expect((await (await send()).json()).error.code).toBe("provider_disconnected");
  expect((await (await send("managed")).json()).error.code).toBe("provider_conflict");
  expect(f.generations).toHaveLength(1);
});

it("requires a capped provider key and drops key material on logout", async () => {
  f.settings.openRouterOAuth = true;
  f.behavior.oauthLimit = null;
  expect((await complete(await begin())).status).toBe(402);
  f.behavior.oauthLimit = 1;
  expect((await complete(await begin())).status).toBe(200);
  await post("/logout");
  expect(f.ledger.db.prepare("SELECT count(*) n FROM mobile_provider_keys").get().n).toBe(0);
});

it("does not restore credentials when disconnect races an in-flight exchange", async () => {
  f.settings.openRouterOAuth = true;
  const started = Promise.withResolvers(), released = Promise.withResolvers();
  f.behavior.beforeExchange = () => { started.resolve(); return released.promise; };
  const result = complete(await begin());
  await started.promise;
  await post("/provider/disconnect");
  released.resolve();
  expect((await result).status).toBe(409);
  expect(f.ledger.db.prepare("SELECT count(*) n FROM mobile_provider_keys").get().n).toBe(0);
});


it("protects history from a different session's payer and releases yesterday's personal daily allowance", async () => {
  f.settings.openRouterOAuth = true;
  await complete(await begin());
  f.behavior.disconnect = true;
  expect(await (await send()).text()).toContain("interrupted");
  f.ledger.db.prepare("UPDATE mobile_byok_usage SET reserved=250000").run();
  expect((await send()).status).toBe(429);
  f.ledger.db.prepare("UPDATE mobile_byok_usage SET created=created-86400000").run();
  f.behavior.disconnect = false;
  expect(await (await send()).text()).toContain("complete");
  cookie = await f.login(account);
  await complete(await begin());
  expect((await (await send()).json()).error.code).toBe("provider_conflict");
  expect(f.generations).toHaveLength(2);
});

it("retries confirmed personal credit rejections with the same ID and retains rejected attempts for rate limits", async () => {
  f.settings.openRouterOAuth = true;
  await complete(await begin());
  const body = { thread, id:randomUUID(), prompt:"hello", save:true, provider:"openrouter" };
  for (const status of [429,402]) {
    f.behavior.chatRejection = status;
    expect((await post("/send", body)).status).toBe(status);
  }
  expect(f.ledger.db.prepare("SELECT httpStatus FROM mobile_byok_rejections ORDER BY rowid").all().map(x => x.httpStatus)).toEqual([429,402]);
  expect(f.ledger.db.prepare("SELECT count(*) n FROM mobile_byok_usage").get().n).toBe(0);
  f.behavior.chatRejection = 0;
  expect((await post("/send", { ...body, prompt:"different" })).status).toBe(409);
  expect(await (await post("/send", body)).text()).toContain('"state":"complete"');
  expect((await post("/send", body)).status).toBe(409);
  expect(f.generations).toHaveLength(1);
  f.behavior.chatRejection = 429;
  for (let i = 0; i < 7; i++) expect((await send()).status).toBe(429);
  const limited = await send();
  expect((await limited.json()).error.code).toBe("account_rate_limit");
});
