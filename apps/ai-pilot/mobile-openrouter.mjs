import { createHash, randomBytes } from "node:crypto";
import { digest, Fault } from "./ledger.mjs";
import { boundedRequest, maximumCost } from "./router.mjs";
import { consumeMobileStream } from "./mobile-stream.mjs";

const base = "https://openrouter.ai/api/v1/";
const expiresIn = 10 * 60000;

export function mobileOpenRouter(ledger, settings, http) {
  const db = ledger.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_pkce(session TEXT PRIMARY KEY REFERENCES mobile_sessions(handle) ON DELETE CASCADE,
      state TEXT NOT NULL,verifier BLOB NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mobile_provider_keys(session TEXT PRIMARY KEY REFERENCES mobile_sessions(handle) ON DELETE CASCADE,
      sealed BLOB NOT NULL,keyHash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mobile_byok_usage(owner TEXT NOT NULL,id TEXT NOT NULL,created INTEGER NOT NULL,
      model TEXT NOT NULL,keyHash TEXT NOT NULL,reserved INTEGER NOT NULL,cost INTEGER,generation TEXT,input INTEGER,output INTEGER,PRIMARY KEY(owner,id));
    CREATE INDEX IF NOT EXISTS mobile_byok_time ON mobile_byok_usage(owner,created);
    CREATE TABLE IF NOT EXISTS mobile_byok_threads(owner TEXT NOT NULL,thread TEXT NOT NULL,keyHash TEXT NOT NULL,PRIMARY KEY(owner,thread),
      FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
  `);
  const personal = db.prepare("SELECT sealed,keyHash FROM mobile_provider_keys WHERE session=?");
  function info(session) {
    const key = personal.get(session.hash);
    return { enabled:settings.openRouterOAuth === true, connected:Boolean(key), settingsURL:key ? "https://openrouter.ai/keys/" + key.keyHash : null };
  }
  function start(session) {
    if (!settings.openRouterOAuth) throw new Fault(404, "provider_disabled");
    const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
    db.prepare("INSERT OR REPLACE INTO mobile_pkce VALUES (?,?,?,?)")
      .run(session.hash, digest(state), session.seal("openrouter-verifier", verifier), Date.now() + expiresIn);
    const url = new URL("https://openrouter.ai/auth");
    url.search = new URLSearchParams({ callback_url:settings.mobileOrigin + "/mobile/callback", state,
      code_challenge:createHash("sha256").update(verifier).digest("base64url"), code_challenge_method:"S256",
      limit:"1.00", expiration:"1-day", key_label:"StartupBot Mobile" }).toString();
    return { url:url.href };
  }
  async function complete(session, body) {
    if (!settings.openRouterOAuth || typeof body.code !== "string" || !body.code || body.code.length > 1024 ||
        typeof body.state !== "string" || body.state.length !== 43) throw new Fault(400, "invalid_callback");
    const pending = db.prepare("UPDATE mobile_pkce SET expires=0 WHERE session=? AND state=? AND expires>? RETURNING verifier")
      .get(session.hash, digest(body.state), Date.now());
    if (!pending) throw new Fault(409, "invalid_callback");
    const response = await http(base + "auth/keys", { method:"POST", redirect:"error", signal:AbortSignal.timeout(15000),
      headers:{ "content-type":"application/json" }, body:JSON.stringify({ code:body.code,
        code_verifier:session.open("openrouter-verifier", pending.verifier), code_challenge_method:"S256" }) });
    const key = response.ok && (await response.json()).key;
    if (typeof key !== "string" || !key || key.length > 8192) throw new Fault(400, "provider_connection_failed");
    const access = await http(base + "key", { headers:{ authorization:"Bearer " + key }, redirect:"error", signal:AbortSignal.timeout(15000) });
    const data = access.ok && (await access.json()).data;
    if (!Number.isFinite(data?.limit_remaining) || data.limit_remaining <= 0) throw new Fault(402, "provider_limit_required");
    ledger.tx(() => {
      if (!db.prepare("DELETE FROM mobile_pkce WHERE session=? AND state=? AND expires=0").run(session.hash, digest(body.state)).changes)
        throw new Fault(409, "invalid_callback");
      db.prepare("INSERT OR REPLACE INTO mobile_provider_keys VALUES (?,?,?)")
        .run(session.hash, session.seal("openrouter-key", key), digest(key));
    });
    return info(session);
  }
  function disconnect(session) {
    db.prepare("DELETE FROM mobile_pkce WHERE session=?").run(session.hash);
    db.prepare("DELETE FROM mobile_provider_keys WHERE session=?").run(session.hash);
    return info(session);
  }
  async function run(session, id, body, config, stream) {
    const key = settings.openRouterOAuth && personal.get(session.hash);
    if (!key) throw new Fault(409, "provider_disconnected");
    const request = boundedRequest(body, config, session.owner), reserve = maximumCost(request, config);
    const now = Date.now(), day = new Date(now);
    day.setUTCHours(0,0,0,0);
    const bearer = session.open("openrouter-key", key.sealed);
    stream.signal.throwIfAborted();
    ledger.tx(() => {
      if (db.prepare("SELECT 1 FROM mobile_byok_usage WHERE owner=? AND id=?").get(session.owner, id))
        throw new Fault(409, "request_exists");
      const exposure = db.prepare("SELECT coalesce(sum(coalesce(cost,reserved)),0) n FROM mobile_byok_usage WHERE owner=? AND created>=?").get(session.owner, +day).n;
      const recent = db.prepare("SELECT count(*) n FROM mobile_byok_usage WHERE owner=? AND created>=?").get(session.owner, now-60000).n;
      if (recent >= 10) throw new Fault(429, "account_rate_limit");
      if (exposure + reserve > 250000) throw new Fault(429, "provider_daily_limit");
      db.prepare("INSERT INTO mobile_byok_usage(owner,id,created,model,keyHash,reserved) VALUES (?,?,?,?,?,?)")
        .run(session.owner, id, now, config.model, key.keyHash, reserve);
    });
    const response = await http(base + "chat/completions", { method:"POST", redirect:"error",
      signal:AbortSignal.any([stream.signal, AbortSignal.timeout(90000)]),
      headers:{ authorization:"Bearer " + bearer, "content-type":"application/json" },
      body:JSON.stringify({ ...request, stream:true }) });
    if (!response.ok) {
      if ([400,401,402,403,404,413,422,429].includes(response.status))
        db.prepare("UPDATE mobile_byok_usage SET cost=0 WHERE owner=? AND id=?").run(session.owner,id);
      throw new Fault(503, "provider_connection_failed");
    }
    const result = await consumeMobileStream(response, stream, generation => {
      db.prepare("UPDATE mobile_byok_usage SET generation=? WHERE owner=? AND id=?").run(generation, session.owner, id);
    });
    const usage = result.usage;
    if (Number.isFinite(usage?.cost) && usage.cost >= 0 && Number.isSafeInteger(Math.ceil(usage.cost * 1000000))) {
      const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
      db.prepare("UPDATE mobile_byok_usage SET cost=?,input=?,output=? WHERE owner=? AND id=?")
        .run(Math.ceil(usage.cost * 1000000), count(usage.prompt_tokens), count(usage.completion_tokens), session.owner, id);
    }
    return result;
  }
  return { info, start, complete, disconnect, run, keyHash:session => personal.get(session.hash)?.keyHash };
}
