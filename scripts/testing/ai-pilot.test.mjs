import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Ledger, catalog } from "../../apps/ai-pilot/ledger.mjs";
import { pilotServer } from "../../apps/ai-pilot/server.mjs";
import { router } from "../../apps/ai-pilot/router.mjs";

let dir, ledger, settings, config, server, url, a, b, http, remote;
const stamp = () => Math.floor(Date.now() / 1000);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "startupbot-wallet-"));
  ledger = new Ledger(join(dir, "ledger.sqlite"));
  config = catalog(new URL("../../apps/ai-pilot/catalog.example.json", import.meta.url));
  settings = {
    catalog: join(dir, "offers.json"),
    stripeKey: "sk_test_fixture",
    webhookSecret: "whsec_fixture",
    origin: "http://127.0.0.1",
    masterKey: Buffer.alloc(32, 7).toString("base64"),
    managementKey: "fixture-admin",
  };
  writeFileSync(settings.catalog, JSON.stringify(config));
  a = ledger.issue("account-a");
  b = ledger.issue("account-b");
  remote = new Map();
  http = vi.fn(async (raw, init) => {
    const path = new URL(raw).pathname;
    if (path === "/v1/checkout/sessions") {
      const id = init.body.get("client_reference_id"),
        session = {
          id: "cs_test_" + id,
          client_reference_id: id,
          metadata: { order: id },
          url: "https://checkout.stripe.com/c/pay/cs_test_" + id,
          livemode: false,
        };
      remote.set("/v1/checkout/sessions/" + session.id, session);
      return Response.json(session);
    }
    if (path === "/api/v1/keys")
      return Response.json({ key: "secret-" + randomUUID(), data: { hash: randomUUID() } });
    if (path === "/api/v1/chat/completions")
      return Response.json({
        id: "gen-" + randomUUID(),
        model: config.model,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { cost: 0.00025, prompt_tokens: 17, completion_tokens: 8 },
      });
    if (remote.has(path)) return Response.json(remote.get(path));
    throw new Error("unexpected fixture request " + path);
  });
  server = pilotServer(ledger, settings, http);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = "http://127.0.0.1:" + server.address().port;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
});
function call(path, token, body, headers = {}) {
  return fetch(url + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer " + token, "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function order(sku, token = a, id = randomUUID()) {
  const offer = config.offers[sku];
  const response = await call("/wallet/checkout", token, {
    id,
    sku,
    amount: offer.amountMinor,
    credits: offer.creditMicros,
    currency: config.currency,
    version: config.version,
  });
  expect(response.status).toBe(200);
  return { id, session: remote.get("/v1/checkout/sessions/cs_test_" + id) };
}
function notify(type, object, eventId = randomUUID(), valid = true, live = false) {
  const body = JSON.stringify({ id: eventId, type, livemode: live, data: { object } });
  const t = stamp(),
    v = createHmac("sha256", valid ? settings.webhookSecret : "wrong")
      .update(t + "." + body)
      .digest("hex");
  return fetch(url + "/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=" + t + ",v1=" + v },
    body,
  });
}
async function paidTopup(token = a) {
  const o = await order("topup", token);
  Object.assign(o.session, {
    status: "complete",
    mode: "payment",
    payment_status: "paid",
    payment_intent: "pi_" + o.id,
    created: stamp(),
    amount_total: config.offers.topup.amountMinor,
    currency: config.currency,
  });
  expect((await notify("checkout.session.completed", o.session)).status).toBe(200);
  return o;
}
const summary = async (token = a) => (await call("/wallet", token)).json();
const chat = (token = a, id = randomUUID(), options = {}) =>
  call(
    "/v1/chat/completions",
    token,
    { model: config.model, messages: [{ role: "user", content: "hello" }], ...options },
    { "idempotency-key": id },
  );

it("keeps each account isolated, reads back a signed paid checkout, rotates restricted engine keys, and settles the upstream cost once", async () => {
  const o = await paidTopup();
  expect((await notify("checkout.session.completed", o.session)).status).toBe(200);
  expect((await summary()).purchased).toBe(1000000);
  expect((await summary(b)).purchased).toBe(0);
  expect((await chat(b)).status).toBe(402);
  const token = (await (await call("/wallet/engine-token", a, {})).json()).token;
  expect((await call("/wallet", token)).status).toBe(401);
  const id = randomUUID(),
    result = await chat(token, id, { stream: true });
  expect(await result.text()).toContain("data: [DONE]");
  expect((await chat(token, id)).status).toBe(409);
  expect((await summary()).purchased).toBe(999750);
  expect((await summary()).usage).toEqual({ cost: 250, input: 17, output: 8 });
  expect((await summary(b)).usage).toEqual({ cost: 0, input: null, output: null });
  expect((await summary(b)).recent).toEqual([]);
  expect(ledger.db.prepare("SELECT secret FROM users WHERE id=?").get("account-a").secret).not.toContain(
    "secret-",
  );
  await paidTopup(b);
  expect((await chat(b)).status).toBe(200);
  const keys = http.mock.calls
    .filter(([raw]) => raw.endsWith("/chat/completions"))
    .map(([, init]) => init.headers.authorization);
  expect(new Set(keys).size).toBe(2);
  await call("/wallet/engine-token", a, {});
  expect((await chat(token)).status).toBe(401);
});

it.each(["monthly", "annual"])(
  "honors the original %s price across repricing, replay, failed renewal and period boundaries",
  async (sku) => {
    const o = await order(sku),
      amount = config.offers[sku].amountMinor,
      credits = config.offers[sku].creditMicros;
    const interval = sku === "annual" ? "year" : "month",
      duration = (sku === "annual" ? 365 : 30) * 86400;
    const sub = { id: "sub_" + o.id, customer: "cus1", livemode: false, metadata: { order: o.id } };
    Object.assign(o.session, { subscription: sub.id });
    remote.set("/v1/subscriptions/" + sub.id, sub);
    const from = stamp() - 10;
    const invoice = {
      id: "in1",
      subscription: sub.id,
      customer: "cus1",
      payment_intent: "pi_1",
      status: "paid",
      livemode: false,
      amount_paid: amount,
      currency: "usd",
      lines: {
        has_more: false,
        data: [
          {
            amount,
            currency: "usd",
            quantity: 1,
            price: { recurring: { interval, interval_count: 1 } },
            period: { start: from, end: from + duration },
          },
        ],
      },
    };
    remote.set("/v1/invoices/in1", invoice);
    config.offers[sku].amountMinor += 200;
    config.offers[sku].creditMicros += 999;
    config.version = "new";
    writeFileSync(settings.catalog, JSON.stringify(config));
    expect((await notify("invoice.payment_failed", invoice)).status).toBe(200);
    expect((await summary()).included).toBe(0);
    expect((await notify("invoice.paid", invoice)).status).toBe(200);
    expect((await notify("invoice.paid", invoice)).status).toBe(200);
    expect((await summary()).included).toBe(credits);
    expect(ledger.balances("account-a", (from + duration) * 1000)[0].available).toBe(0);
    invoice.id = "in2";
    invoice.payment_intent = "pi_2";
    invoice.lines.data[0].period = { start: from + duration, end: from + duration * 2 };
    remote.set("/v1/invoices/in2", invoice);
    await notify("invoice.paid", invoice);
    expect((await summary()).included).toBe(credits);
    expect(ledger.balances("account-a", (from + duration) * 1000).reduce((s, g) => s + g.available, 0)).toBe(
      credits,
    );
  },
);

it("rejects stale quotes, bogus webhooks, live keys and amount mismatches before granting", async () => {
  const body = { id: randomUUID(), sku: "topup", amount: 1, version: config.version, currency: "usd", credits: 1 };
  expect((await call("/wallet/checkout", a, body)).status).toBe(409);
  const o = await order("topup");
  Object.assign(o.session, { mode: "payment", payment_status: "paid", amount_total: 1, currency: "usd" });
  expect((await notify("checkout.session.completed", o.session, randomUUID(), false)).status).toBe(400);
  expect((await notify("checkout.session.completed", o.session, randomUUID(), true, true)).status).toBe(400);
  expect((await notify("checkout.session.completed", o.session)).status).toBe(409);
  settings.stripeKey = "sk_live_invalid";
  expect(
    (
      await call("/wallet/checkout", a, {
        ...body,
        amount: config.offers.topup.amountMinor,
        credits: config.offers.topup.creditMicros,
      })
    ).status,
  ).toBe(503);
  expect((await summary()).purchased).toBe(0);
});
it("deduplicates out-of-order cumulative refunds and accounts for a dispute after spend", async () => {
  const o = await order("topup");
  const ch = { id: "ch_1", payment_intent: "pi_x", amount: 300, amount_refunded: 150, livemode: false };
  remote.set("/v1/charges/ch_1", ch);
  await notify("charge.refunded", ch);
  Object.assign(o.session, {
    mode: "payment",
    payment_status: "paid",
    payment_intent: "pi_x",
    created: stamp(),
    amount_total: 300,
    currency: "usd",
  });
  await notify("checkout.session.completed", o.session);
  await notify("charge.refunded", ch);
  expect((await summary()).purchased).toBe(500000);
  await chat();
  const dispute = { id: "dp1", charge: "ch_1", amount: 150, status: "needs_response", livemode: false };
  remote.set("/v1/disputes/dp1", dispute);
  await notify("charge.dispute.created", dispute);
  expect((await summary()).purchased).toBe(-250);
  expect((await chat()).status).toBe(402);
  dispute.status = "won";
  await notify("charge.dispute.closed", dispute);
  dispute.status = "needs_response";
  await notify("charge.dispute.created", dispute);
  expect((await summary()).purchased).toBe(499750);
});
it("holds ambiguous calls across reopen and settles each allocation to its original grant", async () => {
  config.offers.topup.creditMicros = 15000;
  writeFileSync(settings.catalog, JSON.stringify(config));
  await paidTopup();
  const id = randomUUID();
  http
    .mockImplementationOnce(async () => Response.json({ key: "test-secret", data: { hash: "k" } }))
    .mockImplementationOnce(async () => {
      throw Error("connection lost");
    });
  const results = await Promise.all([chat(a, id), chat()]);
  expect(results.map((r) => r.status).sort()).toEqual([402, 503]);
  const reopened = new Ledger(join(dir, "ledger.sqlite"));
  try {
    const row = reopened.summary("account-a").recent[0];
    expect(row.state).toBe("held");
    reopened.db.prepare("UPDATE requests SET generation=? WHERE id=?").run("gen-known", row.id);
    remote.set("/api/v1/generation", { data: { id: "gen-known", total_cost: 0.001 } });
    await router(reopened, settings, http).reconcile("account-a", row.id);
    await router(reopened, settings, http).reconcile("account-a", row.id);
    expect(reopened.summary("account-a").purchased).toBe(14000);
  } finally {
    reopened.db.close();
  }
});
it("uses included allowance before purchased credit and honors the customer switch", async () => {
  const o = ledger.order("account-a", "monthly", config, randomUUID());
  ledger.grant(o, { id: "in_x", payment: "pi_x", start: Date.now() - 100, end: Date.now() + 60000 });
  await paidTopup();
  ledger.reserve("account-a", "first", "first", o.credits + 100);
  ledger.settle("account-a", "first", "gen-a", o.credits + 50);
  expect((await summary()).purchased).toBe(config.offers.topup.creditMicros - 50);
  await call("/wallet/use-purchased", a, { enabled: false });
  expect((await chat()).status).toBe(402);
  await call("/wallet/use-purchased", a, { enabled: true });
  expect((await chat()).status).toBe(200);
});

it("runs the installed OpenAI-compatible engine through the pilot for chat and a helper", async () => {
  const { OpenAICompatDriver } = await import("../../server/drivers/openai-compat.ts");
  const { recordEvents } = await import("../../server/testing/events.ts");
  await paidTopup();
  const token = ledger.issueEngineToken("account-a");
  const instance = await OpenAICompatDriver.create({
    instanceId: "pilot",
    displayName: "Pilot",
    enabled: true,
    config: { url: url + "/v1", apiKeyEnv: "PILOT_KEY", model: config.model, tools: false },
    environment: { PILOT_KEY: token },
  });
  const recorder = recordEvents(instance.adapter);
  try {
    expect(instance.adapter.capabilities.images).toBe(false);
    expect(instance.adapter.capabilities.nativeImageInput).toBe(false);
    await instance.adapter.sendTurn({ threadId: "test-thread", text: "test", model: config.model,
      images: [{path:join(dir,"unread.png"),mime:"image/png",bytes:12}] });
    expect(await recorder.until((event) => event.type === "turn.completed", 5000)).toMatchObject({ ok: true });
    expect(await instance.generateText("helper test", { model: config.model })).toBe("ok");
    expect((await summary()).purchased).toBe(999500);
    expect((await summary(b)).purchased).toBe(0);
  } finally {
    recorder.stop();
    await instance.dispose();
  }
});

it("binds email sign-in to the invited StartupBot ID and reuses its wallet across distinct expiring sessions", async () => {
  const { invite } = await import("../../apps/ai-pilot/accounts.mjs");
  settings.accountOrigin = "https://account.fixture.test";
  invite(ledger, "account-a", "tester@example.test");
  const who = { id: "account-a", email: "tester@example.test" },
    code = { email: who.email, otp: "12345678" };
  const send = () => call("/wallet/request-code", "", code),
    verify = () => call("/wallet/verify-code", "", code);
  expect((await call("/wallet/request-code", "", { email: "unknown@example.test" })).status).toBe(200);
  expect(http).not.toHaveBeenCalled();
  http.mockImplementation(async (raw, init) => {
    const path = new URL(raw).pathname;
    if (path.endsWith("/send-verification-otp")) return Response.json({ success: true });
    if (path.endsWith("/sign-in/email-otp"))
      return Response.json(
        { user: who, token: "never-use-raw-token" },
        { headers: { "set-auth-token": "signed-fixture-bearer-only-for-test" } },
      );
    if (path === "/api/auth/get-session") return Response.json({ session:{ id:"fixture-wallet-id" } });
    if (path === "/v1/me") {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer signed-fixture-bearer-only-for-test");
      return Response.json({ user: who });
    }
    throw Error("unexpected request");
  });
  expect((await send()).status).toBe(200);
  who.id = "account-b";
  expect((await verify()).status).toBe(401);
  who.id = "account-a";
  const one = (await (await verify()).json()).token,
    two = (await (await verify()).json()).token;
  expect(one).not.toEqual(two);
  expect((await summary(one)).account).toBe("account-a");
  await call("/wallet/sign-out", one, {});
  expect((await call("/wallet", one)).status).toBe(401);
  expect((await call("/wallet", two)).status).toBe(200);
  ledger.db.prepare("UPDATE wallet_sessions SET expires=0").run();
  expect((await call("/wallet", two)).status).toBe(401);
});

it("prevents installing a wallet bearer or a personal inference token in a team-wide engine", async () => {
  const { OpenAICompatDriver } = await import("../../server/drivers/openai-compat.ts");
  const base = {
    instanceId: "pilot",
    displayName: "Pilot",
    enabled: true,
    config: { url: url + "/v1", apiKeyEnv: "PILOT_KEY", tools: false },
  };
  await expect(OpenAICompatDriver.create({ ...base, environment: { PILOT_KEY: a } })).rejects.toThrow(
    /personal pilot/,
  );
  await expect(
    OpenAICompatDriver.create({
      ...base,
      environment: { PILOT_KEY: ledger.issueEngineToken("account-a"), OMB_CLOUD_ROLE: "team" },
    }),
  ).rejects.toThrow(/personal pilot/);
});

it("resumes pending checkouts only at the price the same customer actually reviewed", async () => {
  const { id } = await order("topup");
  config.version = "new";
  config.offers.topup.amountMinor = 800;
  writeFileSync(settings.catalog, JSON.stringify(config));
  const newQuote = { id, sku: "topup", version: "new", amount: 800, credits: 1000000, currency: "usd" };
  expect((await call("/wallet/checkout", a, newQuote)).status).toBe(409);
  const [pending] = (await summary()).pending;
  expect(pending.amount).toBe(300);
  expect((await summary(b)).pending).toEqual([]);
  expect((await call("/wallet/checkout", a, pending)).status).toBe(200);
});

it("retries the same unbilled rate-limited request and settles only one generation", async () => {
  await paidTopup();
  const id = randomUUID();
  http.mockImplementationOnce(async () => Response.json({ key:"secret",data:{hash:"key"} }))
    .mockImplementationOnce(async () => new Response(null,{status:429}));
  expect((await chat(a,id)).status).toBe(503);
  expect((await summary()).purchased).toBe(1000000);
  expect((await summary()).recent[0].state).toBe("retryable");
  expect((await chat(a,id,{temperature:0})).status).toBe(409);
  expect((await chat(a,id)).status).toBe(200);
  expect((await chat(a,id)).status).toBe(409);
  expect((await summary()).usage.cost).toBe(250);
  expect(http.mock.calls.filter(([url])=>url.endsWith("/chat/completions"))).toHaveLength(2);
});
it("keeps an expired allowance tied to a renewable subscription until Stripe verifies termination", async () => {
  const original=await order("monthly");
  const sub={id:"sub_original",status:"past_due",metadata:{order:original.id},livemode:false};
  Object.assign(original.session,{subscription:sub.id});
  remote.set("/v1/subscriptions/"+sub.id,sub);
  const old=ledger.db.prepare("SELECT * FROM orders WHERE id=?").get(original.id);
  ledger.grant(old,{id:"in_old",payment:"pi_old",start:Date.now()-60000,end:Date.now()-20000});
  const replace=()=>call("/wallet/checkout",a,{id:randomUUID(),sku:"annual",version:config.version,currency:config.currency,
    amount:config.offers.annual.amountMinor,credits:config.offers.annual.creditMicros});
  expect(await summary()).toMatchObject({included:0,expires:null,canCancel:true});
  expect((await replace()).status).toBe(409);
  expect((await call("/wallet/cancel-renewal",a,{})).status).toBe(200);
  expect(http.mock.calls.some(([,init])=>init.body?.get("cancel_at_period_end")==="true")).toBe(true);
  expect((await notify("customer.subscription.deleted",sub)).status).toBe(200);
  expect((await replace()).status).toBe(409);
  sub.status="canceled";
  expect((await notify("customer.subscription.deleted",sub)).status).toBe(200);
  expect((await summary()).canCancel).toBe(false);
  expect((await Promise.all([replace(),replace()])).map(r=>r.status).sort()).toEqual([200,409]);
});
