import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { accountSignIn, invite } from "./accounts.mjs";
import { Ledger, Fault, catalog, digest } from "./ledger.mjs";
import { mobileService } from "./mobile.mjs";
import { payments } from "./payments.mjs";
import { asEventStream, router } from "./router.mjs";

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) throw new Fault(413, "request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readObject(req) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault(400, "invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fault(400, "invalid_json");

  return body;
}
function identifier(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{16,100}$/i.test(value))
    throw new Fault(400, "invalid_request_id");
  return value;
}
export function pilotServer(ledger, settings, http = fetch) {
  const gateway = router(ledger, settings, http),
    pay = payments(ledger, settings, http);
  const mobile = mobileService(ledger, settings, gateway, http, readObject);
  return createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    try {
      const path = req.url?.split("?")[0],
        method = req.method;
      if (path === "/mobile" || path?.startsWith("/mobile/")) {
        if (!mobile) throw new Fault(404, "not_found");
        return await mobile(req, res, path, json);
      }
      if (req.headers.origin && req.headers.origin !== settings.origin) throw new Fault(403, "origin_denied");
      if (method === "GET" && (path === "/" || path === "/wallet.js")) {
        const html = path === "/";
        res.writeHead(200, { "content-type": html ? "text/html; charset=utf-8" : "application/javascript" });
        res.end(readFileSync(new URL(html ? "./wallet.html" : "./wallet.js", import.meta.url)));
        return;
      }
      if (method === "POST" && path === "/stripe/webhook") {
        await pay.webhook(await readBody(req), req.headers["stripe-signature"]);
        return json(200, { ok: true });
      }
      if (method === "GET" && path === "/wallet/sign-in-options")
        return json(200, { email: Boolean(settings.accountOrigin) });
      if (method === "POST" && (path === "/wallet/request-code" || path === "/wallet/verify-code")) {
        return json(
          200,
          await accountSignIn(
            ledger,
            settings.accountOrigin,
            http,
            await readObject(req),
            path === "/wallet/verify-code",
          ),
        );
      }
      const bearer = req.headers.authorization?.match(/^Bearer (sbpilot_[\w-]+)$/)?.[1];
      if (!bearer) throw new Fault(401, "invalid_pilot_token");
      const owner = ledger.authenticate(bearer, path?.startsWith("/v1/"));
      const config = catalog(settings.catalog);
      if (method === "GET" && path === "/wallet")
        return json(200, {
          account: owner,
          ...ledger.summary(owner),
          currency: config.currency,
          offers: config.offers,
          model: config.model,
          version: config.version,
        });
      if (method === "GET" && path === "/v1/models")
        return json(200, {
          object: "list",
          data: [{ id: config.model, object: "model", owned_by: "startupbot-pilot" }],
        });
      if (method !== "POST") throw new Fault(404, "not_found");
      const body = await readObject(req);
      if (path === "/wallet/sign-out") {
        ledger.db.prepare("DELETE FROM wallet_sessions WHERE token=? AND owner=?").run(digest(bearer), owner);
        return json(200, { ok: true });
      }
      if (path === "/wallet/engine-token") return json(200, { token: ledger.issueEngineToken(owner) });
      if (path === "/wallet/checkout") {
        const existing = ledger.db
          .prepare("SELECT * FROM orders WHERE id=? AND owner=?")
          .get(identifier(body.id), owner);
        const offer = config.offers[body.sku];
        const quote = existing ?? {
          version: config.version,
          currency: config.currency,
          amount: offer?.amountMinor,
          credits: offer?.creditMicros,
        };
        if (
          body.version !== quote.version ||
          body.amount !== quote.amount ||
          body.credits !== quote.credits ||
          body.currency !== quote.currency
        )
          throw new Fault(409, "price_changed_refresh");
        if (!/^(sk|rk)_test_/.test(settings.stripeKey ?? "") || !settings.webhookSecret?.startsWith("whsec_"))
          throw new Fault(503, "test_checkout_not_configured");
        if (!existing && (body.sku === "monthly" || body.sku === "annual"))
          await pay.refreshSubscription(ledger.recurringOrder(owner));
        const order = ledger.order(owner, body.sku, config, body.id);
        return json(200, { url: await pay.checkout(order) });
      }
      if (path === "/wallet/cancel-renewal") {
        await pay.cancel(owner);
        return json(200, { ok: true });
      }
      if (path === "/wallet/use-purchased" && typeof body.enabled === "boolean") {
        ledger.db.prepare("UPDATE users SET spendExtras=? WHERE id=?").run(Number(body.enabled), owner);
        return json(200, { ok: true });
      }
      if (path === "/v1/chat/completions") {
        const id = identifier(req.headers["idempotency-key"] ?? randomUUID());
        res.setHeader("x-request-id", id);
        const result = await gateway.run(owner, id, body, config);
        if (!body.stream) return json(200, result);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(asEventStream(result));
        return;
      }
      throw new Fault(404, "not_found");
    } catch (e) {
      const status = e instanceof Fault ? e.status : 503;
      const code = e instanceof Fault ? e.message : "pilot_unavailable";
      json(status, { error: { code, message: code } });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const file = process.env.STARTUPBOT_PILOT_DB;
  if (!file) throw new Error("Set STARTUPBOT_PILOT_DB to a private pilot database path.");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const ledger = new Ledger(file);
  const port = Number(process.env.PORT || 8537);
  const settings = {
    origin: "http://127.0.0.1:" + port,
    catalog: process.env.STARTUPBOT_PILOT_CATALOG || new URL("./catalog.example.json", import.meta.url),
    mobileOrigin: process.env.STARTUPBOT_MOBILE_ORIGIN,
    accountOrigin: process.env.STARTUPBOT_PILOT_ACCOUNT_ORIGIN,
    stripeKey: process.env.STRIPE_TEST_KEY,
    webhookSecret: process.env.STRIPE_TEST_WEBHOOK_SECRET,
    managementKey: process.env.OPENROUTER_PILOT_MANAGEMENT_KEY,
    masterKey: process.env.STARTUPBOT_PILOT_ENCRYPTION_KEY,
  };
  const [command, owner, id, generation] = process.argv.slice(2);
  if (command === "issue-token") console.log(ledger.issue(owner ?? ""));
  else if (command === "invite") invite(ledger, owner, id);
  else if (command === "revoke-token")
    ledger.tx(() => {
      ledger.db.prepare("INSERT OR IGNORE INTO managed_suspensions SELECT id FROM users WHERE id=?").run(owner);
      ledger.db.prepare("DELETE FROM invites WHERE owner=?").run(owner);
      ledger.db.prepare("DELETE FROM wallet_sessions WHERE owner=?").run(owner);
      ledger.db.prepare("UPDATE users SET token=?,engineToken=NULL WHERE id=?").run(randomUUID(), owner);
    });
  else if (command === "resume-managed") ledger.db.prepare("DELETE FROM managed_suspensions WHERE owner=?").run(owner);
  else if (command === "reconcile") {
    await router(ledger, settings).reconcile(owner, id, generation);
  } else if (command === "serve") {
    catalog(settings.catalog);
    pilotServer(ledger, settings).listen(port, "127.0.0.1", () => console.log(settings.origin));
  } else
    throw new Error(
      "Use serve, invite ACCOUNT EMAIL, issue-token ACCOUNT, revoke-token ACCOUNT or reconcile ACCOUNT REQUEST [GENERATION].",
    );
}
