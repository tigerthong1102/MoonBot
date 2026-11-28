import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export class Fault extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export function catalog(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const integer = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;
  if (
    !data.version ||
    !/^[a-z]{3}$/.test(data.currency) ||
    !/^[\w.-]+\/[\w.-]+$/.test(data.model) ||
    !integer(data.maxOutput, 32768) ||
    !integer(data.keyLimitUsd, 1000) ||
    ![data.maxPromptUsdPerMillion, data.maxOutputUsdPerMillion].every(
      (n) => n > 0 && n <= 100 && Number.isFinite(n),
    ) ||
    Object.keys(data.offers).sort().join() !== "annual,monthly,topup" ||
    Object.values(data.offers).some(
      (o) => !integer(o.amountMinor, 99999999) || !integer(o.creditMicros, 1000000000),
    )
  ) {
    throw new Fault(503, "invalid_catalog");
  }
  if (data.managedLimits != null) {
    for (const field of ["monthlyMicros", "dailyMicros", "requestsPerMinute", "concurrent"]) {
      if (!integer(data.managedLimits[field], Number.MAX_SAFE_INTEGER)) throw new Fault(503, "invalid_catalog");
    }
    if (typeof data.managedLimits.enabled !== "boolean") throw new Fault(503, "invalid_catalog");
  }
  return data;
}

export class Ledger {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, spendExtras INTEGER DEFAULT 1,
        engineToken TEXT UNIQUE, keyState TEXT, keyName TEXT, keyHash TEXT, secret TEXT);
      CREATE TABLE IF NOT EXISTS invites(owner TEXT PRIMARY KEY REFERENCES users(id),email TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS wallet_sessions(token TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), sku TEXT NOT NULL,
        version TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, credits INTEGER NOT NULL, session TEXT UNIQUE,
        created INTEGER NOT NULL, url TEXT, state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS subscriptions(orderId TEXT PRIMARY KEY REFERENCES orders(id), stripeId TEXT UNIQUE NOT NULL, ended INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, payment TEXT UNIQUE NOT NULL, owner TEXT NOT NULL REFERENCES users(id),
        orderId TEXT NOT NULL REFERENCES orders(id), start INTEGER NOT NULL, end INTEGER, credits INTEGER NOT NULL, spent INTEGER DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS paid_period ON grants(orderId,start) WHERE end IS NOT NULL;
      CREATE TABLE IF NOT EXISTS reversals(event TEXT PRIMARY KEY, payment TEXT NOT NULL, amount INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS disputes(id TEXT PRIMARY KEY, payment TEXT NOT NULL, held INTEGER NOT NULL, final INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS disputed_payments ON disputes(payment);
      CREATE INDEX IF NOT EXISTS by_payment ON reversals(payment);
      CREATE TABLE IF NOT EXISTS requests(id TEXT NOT NULL, owner TEXT NOT NULL REFERENCES users(id), fingerprint TEXT NOT NULL,
        state TEXT NOT NULL, generation TEXT UNIQUE, cost INTEGER, created INTEGER NOT NULL, PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS usage_details(owner TEXT NOT NULL, requestId TEXT NOT NULL, model TEXT, input INTEGER, output INTEGER,
        PRIMARY KEY(owner,requestId), FOREIGN KEY(owner,requestId) REFERENCES requests(owner,id));
      CREATE TABLE IF NOT EXISTS allocations(owner TEXT NOT NULL, request TEXT NOT NULL, grantId TEXT NOT NULL REFERENCES grants(id),
        held INTEGER NOT NULL, PRIMARY KEY(owner,request,grantId), FOREIGN KEY(owner,request) REFERENCES requests(owner,id));
      CREATE TABLE IF NOT EXISTS managed_suspensions(owner TEXT PRIMARY KEY REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS managed_rate(owner TEXT PRIMARY KEY REFERENCES users(id),start INTEGER NOT NULL,count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS active_requests(owner TEXT NOT NULL,id TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,id));
      CREATE INDEX IF NOT EXISTS active_expiry ON active_requests(expires);
      CREATE INDEX IF NOT EXISTS requests_created ON requests(created);
      CREATE INDEX IF NOT EXISTS requests_state ON requests(state);
      CREATE INDEX IF NOT EXISTS by_owner ON grants(owner,end);
    `);
  }
  tx(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  issue(owner) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Fault(400, "invalid_account");
    const token = "sbpilot_" + randomBytes(32).toString("base64url");
    this.db
      .prepare(
        "INSERT INTO users(id,token) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,engineToken=NULL",
      )
      .run(owner, digest(token));
    return token;
  }
  issueEngineToken(owner) {
    const token = "sbpilot_engine_" + randomBytes(32).toString("base64url");
    this.db.prepare("UPDATE users SET engineToken=? WHERE id=?").run(digest(token), owner);
    return token;
  }
  authenticate(token, inference = false) {
    const hash = digest(token);
    if (token.startsWith("sbpilot_session_")) {
      const session = this.db
        .prepare("SELECT owner FROM wallet_sessions WHERE token=? AND expires>?")
        .get(hash, Date.now());
      if (!session) throw new Fault(401, "invalid_pilot_token");
      return session.owner;
    }
    const row = inference
      ? this.db.prepare("SELECT id FROM users WHERE token=? OR engineToken=?").get(hash, hash)
      : this.db.prepare("SELECT id FROM users WHERE token=?").get(hash);
    if (!row) throw new Fault(401, "invalid_pilot_token");
    return row.id;
  }
  recurringOrder(owner) {
    return this.db.prepare(`SELECT o.*,s.stripeId FROM orders o LEFT JOIN subscriptions s ON s.orderId=o.id
      WHERE o.owner=? AND o.sku!='topup' AND o.state IN ('pending','paid') AND COALESCE(s.ended,0)=0
      ORDER BY o.created DESC LIMIT 1`).get(owner);
  }
  trackSubscription(order, sub) {
    if (order.sku === "topup" || !sub.id || sub.metadata?.order !== order.id) throw new Fault(409, "subscription_mismatch");
    const ended = Number(["canceled","incomplete_expired"].includes(sub.status));
    const update = this.db.prepare(`INSERT INTO subscriptions VALUES (?,?,?)
      ON CONFLICT(orderId) DO UPDATE SET ended=max(ended,excluded.ended) WHERE stripeId=excluded.stripeId`).run(order.id,sub.id,ended);
    if (!update.changes) throw new Fault(409, "subscription_mismatch");
    if (ended) this.db.prepare("UPDATE orders SET state='expired' WHERE id=? AND state='pending'").run(order.id);
  }
  order(owner, sku, config, id) {
    if (!Object.hasOwn(config.offers, sku)) throw new Fault(400, "unknown_offer");
    const offer = config.offers[sku];
    return this.tx(() => {
      const query = this.db.prepare("SELECT * FROM orders WHERE id=?");
      const old = query.get(id);
      if (old && (old.owner !== owner || old.sku !== sku)) throw new Fault(409, "order_conflict");
      if (old) return old;
      if (sku !== "topup") {
        const active = this.db.prepare("SELECT 1 FROM grants WHERE owner=? AND end>?").get(owner, Date.now());
        if (active || this.recurringOrder(owner)) throw new Fault(409, "subscription_active_or_pending");
      }
      this.db
        .prepare(
          "INSERT INTO orders(id,owner,sku,version,amount,currency,credits,created) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(id, owner, sku, config.version, offer.amountMinor, config.currency, offer.creditMicros, Date.now());
      return query.get(id);
    });
  }
  grant(order, event) {
    const { id, payment, start, end } = event;
    if (
      !id ||
      !payment ||
      !Number.isSafeInteger(start) ||
      (order.sku !== "topup" && !(Number.isSafeInteger(end) && end > start))
    )
      throw new Fault(400, "invalid_payment_period");
    this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO grants(id,payment,owner,orderId,start,end,credits) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(id, payment, order.owner, order.id, start, end, order.credits);
      const found = this.db.prepare("SELECT * FROM grants WHERE id=?").get(id);
      if (!found || found.payment !== payment || found.orderId !== order.id)
        throw new Fault(409, "payment_conflict");
      this.db.prepare("UPDATE orders SET state='paid' WHERE id=?").run(order.id);
    });
  }
  balances(owner, now = Date.now()) {
    const rows = this.db
      .prepare(
        `SELECT g.*, o.amount, COALESCE((SELECT max(r.amount) FROM reversals r WHERE r.payment=g.payment),0) + COALESCE((SELECT sum(d.held) FROM disputes d WHERE d.payment=g.payment),0) reversed
      FROM grants g JOIN orders o ON o.id=g.orderId WHERE g.owner=? ORDER BY g.end IS NULL,g.end,g.start,g.id`,
      )
      .all(owner);
    return rows.map((g) => {
      const revoked = Math.ceil(g.credits * Math.min(1, g.reversed / g.amount));
      const net = g.credits - revoked - g.spent;
      const valid = g.start <= now && (g.end === null || g.end > now);
      return { id: g.id, end: g.end, available: valid ? net : Math.min(0, net) };
    });
  }
  summary(owner) {
    const buckets = this.balances(owner);
    const spendExtras = !!this.db.prepare("SELECT spendExtras FROM users WHERE id=?").get(owner).spendExtras;
    const recent = this.db
      .prepare(
        `SELECT r.id,r.state,r.cost,r.created,d.model,d.input,d.output FROM requests r
        LEFT JOIN usage_details d ON d.owner=r.owner AND d.requestId=r.id WHERE r.owner=? ORDER BY r.created DESC LIMIT 20`,
      )
      .all(owner);
    const orders = this.db
      .prepare(
        "SELECT id,sku,state,amount,currency,created FROM orders WHERE owner=? ORDER BY created DESC LIMIT 10",
      )
      .all(owner);
    const pending = this.db
      .prepare(
        "SELECT id,sku,amount,credits,version,currency FROM orders WHERE owner=? AND state='pending' ORDER BY created DESC",
      )
      .all(owner);
    const usage = this.db
      .prepare(
        `SELECT coalesce(sum(r.cost),0) cost,sum(d.input) input,sum(d.output) output
      FROM requests r LEFT JOIN usage_details d ON d.owner=r.owner AND d.requestId=r.id WHERE r.owner=? AND r.state='settled'`,
      )
      .get(owner);
    const recurring = this.recurringOrder(owner);
    return {
      canCancel: Boolean(recurring && (recurring.stripeId || recurring.state === "paid")),
      usage,
      pending,
      included: buckets.filter((b) => b.end).reduce((n, b) => n + b.available, 0),
      purchased: buckets.filter((b) => !b.end).reduce((n, b) => n + b.available, 0),
      expires: buckets.find((b) => b.end > Date.now())?.end ?? null,
      spendExtras,
      recent,
      orders,
    };
  }
  reserve(owner, id, fingerprint, amount, model = null, limits = null) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Fault(400, "invalid_hold");
    this.tx(() => {
      const old = this.db.prepare("SELECT fingerprint,state FROM requests WHERE id=? AND owner=?").get(id, owner);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new Fault(409,"request_conflict");
        if (old.state !== "retryable") throw new Fault(409,"request_"+old.state);
        this.db.prepare("DELETE FROM allocations WHERE owner=? AND request=?").run(owner,id);
        this.db.prepare("DELETE FROM usage_details WHERE owner=? AND requestId=?").run(owner,id);
        this.db.prepare("DELETE FROM requests WHERE owner=? AND id=?").run(owner,id);
      }
      if (this.db.prepare("SELECT 1 FROM managed_suspensions WHERE owner=?").get(owner)) throw new Fault(403, "managed_access_revoked");
      if (limits) {
        this.db.prepare("DELETE FROM active_requests WHERE expires<=?").run(Date.now());
        this.checkManagedLimits(owner, amount, limits);
        this.db.prepare("INSERT INTO active_requests VALUES (?,?,?)").run(owner, id, Date.now() + 5 * 60000);
      }
      const extras = this.db.prepare("SELECT spendExtras FROM users WHERE id=?").get(owner).spendExtras;
      const buckets = this.balances(owner).filter((b) => b.end || extras || b.available < 0);
      if (buckets.reduce((n, b) => n + b.available, 0) < amount) throw new Fault(402, "personal_credit_exhausted");
      this.db
        .prepare("INSERT INTO requests(id,owner,fingerprint,state,created) VALUES (?,?,?,'held',?)")
        .run(id, owner, fingerprint, Date.now());
      this.db.prepare("INSERT INTO usage_details(owner,requestId,model) VALUES (?,?,?)").run(owner, id, model);
      for (const b of buckets) {
        const held = Math.min(amount, Math.max(0, b.available));
        if (!held) continue;
        this.db.prepare("INSERT INTO allocations VALUES (?,?,?,?)").run(owner, id, b.id, held);
        this.db.prepare("UPDATE grants SET spent=spent+? WHERE id=?").run(held, b.id);
        amount -= held;
        if (!amount) break;
      }
    });
  }
  checkManagedLimits(owner, amount, limits) {
    if (!limits.enabled) throw new Fault(503, "managed_ai_paused");
    const now = Date.now();
    const active = this.db.prepare("SELECT count(*) n FROM active_requests WHERE owner=?").get(owner).n;
    this.db.prepare(`INSERT INTO managed_rate VALUES (?,?,1) ON CONFLICT(owner) DO UPDATE SET
      count=CASE WHEN start<=excluded.start-60000 THEN 1 ELSE count+1 END,
      start=CASE WHEN start<=excluded.start-60000 THEN excluded.start ELSE start END`).run(owner, now);
    const recent = this.db.prepare("SELECT count FROM managed_rate WHERE owner=?").get(owner).count;
    if (active >= limits.concurrent || recent > limits.requestsPerMinute) throw new Fault(429, "account_rate_limit");
    const day = new Date(now);
    day.setUTCHours(0, 0, 0, 0);
    const month = new Date(day);
    month.setUTCDate(1);
    const exposure = this.db.prepare(`SELECT coalesce(sum(CASE WHEN r.state='held' THEN
        (SELECT sum(held) FROM allocations a WHERE a.owner=r.owner AND a.request=r.id)
        ELSE r.cost END),0) total FROM requests r WHERE r.state='held' OR r.created>=?`);
    if (exposure.get(+day).total + amount > limits.dailyMicros ||
        exposure.get(+month).total + amount > limits.monthlyMicros) throw new Fault(429, "managed_budget_exhausted");
  }
  settle(owner, id, generation, cost, tokens = {}, retryable = false) {
    if (!Number.isSafeInteger(cost) || cost < 0 || !generation || (retryable && cost !== 0)) throw new Fault(503, "reconciliation_required");
    this.tx(() => {
      const row = this.db.prepare("SELECT * FROM requests WHERE owner=? AND id=?").get(owner, id);
      if (!row || (row.generation && generation !== row.generation)) throw new Fault(409, "generation_conflict");
      if (row.state !== "held") {
        if (row.cost !== cost) throw new Fault(409, "cost_conflict");
        return;
      }
      const parts = this.db
        .prepare(
          `SELECT a.* FROM allocations a JOIN grants g ON g.id=a.grantId
        WHERE a.owner=? AND a.request=? ORDER BY g.end IS NULL,g.end,g.start,g.id`,
        )
        .all(owner, id);
      let remaining = cost;
      for (const [i, p] of parts.entries()) {
        const used = i === parts.length - 1 ? remaining : Math.min(remaining, p.held);
        this.db.prepare("UPDATE grants SET spent=spent+? WHERE id=?").run(used - p.held, p.grantId);
        remaining -= used;
      }
      const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);
      this.db
        .prepare("UPDATE usage_details SET input=?,output=? WHERE owner=? AND requestId=?")
        .run(count(tokens.input), count(tokens.output), owner, id);
      this.db
        .prepare("UPDATE requests SET state=?,generation=?,cost=? WHERE owner=? AND id=?")
        .run(retryable ? "retryable" : "settled",generation, cost, owner, id);
    });
  }
}
