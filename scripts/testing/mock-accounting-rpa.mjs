import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

const capability = "accounting.draft.create";
const approvalTimeoutMs = 30_000;
const adapter = Object.freeze({
  vendor: "StartupBot fixtures",
  product: "Synthetic Accounting",
  edition: "Test",
  version: "1",
  testedVersions: Object.freeze(["1"]),
  surface: "mock",
  operation: "draft",
  requiresApproval: true,
  permission: capability,
  verification: "persisted draft read-back",
});
export const workflow = Object.freeze({
  schemaVersion: 1,
  id: "mock-accounting-draft",
  version: 1,
  provenance: "startupbot:checked-in-test-fixture",
  adapter: "synthetic-accounting@1",
  inputSchema: "voucher-v1",
  precondition: "fixture-scope-and-open-period",
  steps: Object.freeze(["save-draft"]),
  wait: "bounded synchronous fixture read-back",
  postcondition: "persisted draft equals intended draft",
  verification: "independent persisted read-back",
  requiredPermissions: Object.freeze([capability]),
  onError: "read-by-idempotency-key",
  recovery: "read-only after dispatch",
});

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const trustedDigest = digest(workflow);
const token = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/u;
const companies = new Set(["DEMO-A", "DEMO-B"]);
const accounts = new Set(["1111", "1121", "131", "511"]);
const parties = new Set(["0001", "0002"]);
const fields = (object, keys) => object && typeof object === "object" && !Array.isArray(object) &&
  Object.keys(object).length === keys.length && keys.every((key) => Object.hasOwn(object, key));
const isToken = (value) => typeof value === "string" && token.test(value);

function minorUnits(amount, scale) {
  const expression = scale === 0 ? /^(0|[1-9][0-9]{0,17})$/u : /^(0|[1-9][0-9]{0,17})(?:\.([0-9]{1,2}))?$/u;
  const match = typeof amount === "string" && expression.exec(amount);
  if (!match) return null;
  const result = BigInt(match[1] + (match[2] ?? "").padEnd(scale, "0"));
  return result > 0n ? result : null;
}

function dateFits(date, fiscalYear, period) {
  const match = typeof date === "string" && /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(date);
  if (!match || match[3] !== fiscalYear || period !== fiscalYear + "-" + match[2]) return false;
  const [day, month, year] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validateVoucher(voucher) {
  if (!fields(voucher, ["company", "fiscalYear", "period", "date", "voucherId", "currency", "lines"])) return { reason: "bad-input" };
  const { company, fiscalYear, period, date, voucherId, currency, lines } = voucher;
  if (!companies.has(company) || fiscalYear !== "2026" || !dateFits(date, fiscalYear, period)) return { reason: "bad-company-or-period" };
  if (period !== "2026-11") return { reason: "locked-period" };
  if (!isToken(voucherId)) return { reason: "bad-id" };
  const scale = currency === "VND" ? 0 : currency === "USD" ? 2 : null;
  if (scale === null || !Array.isArray(lines) || lines.length < 2 || lines.length > 100) return { reason: "bad-input" };
  let debit = 0n;
  let credit = 0n;
  const normalized = [];
  for (const line of lines) {
    if (!fields(line, ["account", "party", "side", "amount"]) || !accounts.has(line.account) || !parties.has(line.party)) {
      return { reason: "unknown-account-or-party" };
    }
    const amount = minorUnits(line.amount, scale);
    if (amount === null || !["debit", "credit"].includes(line.side)) return { reason: "bad-side-or-amount" };
    if (line.side === "debit") debit += amount;
    else credit += amount;
    normalized.push({ account: line.account, party: line.party, side: line.side, minor: amount.toString() });
  }
  if (debit === 0n || debit !== credit) return { reason: "unbalanced" };
  return { expected: { adapter: workflow.adapter, company, fiscalYear, period, date, voucherId, currency, lines: normalized } };
}

const identity = (draft) => digest([draft.company, draft.fiscalYear, "draft", draft.voucherId]);

function connect(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, digest TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, stored TEXT NOT NULL) STRICT;
  `);
  return db;
}

function waitForApproval(approve, binding, signal) {
  if (signal?.aborted) return Promise.resolve({ reason: "stopped" });
  return new Promise((resolve) => {
    function finish(outcome) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stopped);
      resolve(outcome);
    }
    const stopped = () => finish({ reason: "stopped" });
    const timeout = setTimeout(() => finish({ reason: "approval-timeout" }), approvalTimeoutMs);
    signal?.addEventListener("abort", stopped, { once: true });
    Promise.resolve().then(() => signal?.aborted ? undefined : approve(binding)).then(
      (proof) => finish({ proof }),
      () => finish({ reason: "approval-unavailable" }),
    );
  });
}

function runner(db) {
  const reservation = db.prepare("SELECT digest FROM reservations WHERE id = ?");
  const reserve = db.prepare("INSERT INTO reservations (id, digest) VALUES (?, ?) ON CONFLICT(id) DO NOTHING");
  const getDraft = db.prepare("SELECT stored FROM drafts WHERE id = ?");
  const putDraft = db.prepare("INSERT INTO drafts (id, stored) VALUES (?, ?)");
  const count = db.prepare("SELECT COUNT(*) AS count FROM drafts");

  const readStored = (id) => {
    const row = getDraft.get(id);
    return row ? JSON.parse(row.stored) : null;
  };

  function persist(draft, key, fault) {
    if (fault === "before-write-disconnect") throw new Error("fixture disconnected");
    if (fault === "no-effect") return;
    if (fault === "wrong-party") draft.lines[0].party = draft.lines[0].party === "0001" ? "0002" : "0001";
    putDraft.run(key, JSON.stringify(draft));
    if (["response-lost", "readback-unavailable"].includes(fault)) throw new Error("fixture response unavailable");
  }

  async function run({ candidate, voucher, scope, readGrant, approve, signal, fault }) {
    const started = performance.now();
    const states = ["PLANNED"];
    let interventions = 0;
    let writeAttempts = 0;
    const finish = (status, reason) => ({
      status, reason, states: [...states, status], aiCalls: 0, inputTokens: 0, outputTokens: 0,
      cuaCalls: 0, writeAttempts, interventions, elapsedMs: performance.now() - started,
    });
    let approvedWorkflow = false;
    try { approvedWorkflow = digest(candidate) === trustedDigest; } catch { /* Unknown workflow input. */ }
    if (!approvedWorkflow) return finish("BLOCKED", "workflow-untrusted");
    const validated = validateVoucher(voucher);
    if (!validated.expected) return finish("BLOCKED", validated.reason);
    const draft = validated.expected;
    const key = identity(draft);
    const fingerprint = digest(draft);
    const { bot, machine, actor, company } = scope ?? {};
    function permitted() {
      let grant;
      try { grant = readGrant(); } catch { return false; }
      return !signal?.aborted && isToken(bot) && isToken(machine) && isToken(actor) && company === draft.company &&
        grant?.bot === bot && grant.machine === machine && grant.actor === actor && grant.company === company &&
        grant.adapter === workflow.adapter && grant.workflowDigest === trustedDigest && grant.permission === capability &&
        grant.revoked === false && Number.isFinite(grant.expiresAt) && grant.expiresAt > Date.now();
    }
    if (!permitted()) return finish("BLOCKED", signal?.aborted ? "stopped" : "permission");
    states.push("VALIDATED");
    function verify() {
      states.push("VERIFYING");
      try {
        const stored = readStored(key);
        if (!stored) return finish("UNKNOWN", "read-back-missing");
        return digest(stored) === fingerprint ? finish("VERIFIED", "read-back-matched") : finish("FAILED", "read-back-mismatch");
      } catch {
        return finish("UNKNOWN", "read-back-unavailable");
      }
    }
    function recover() {
      const reserved = reservation.get(key);
      if (!reserved) return null;
      if (reserved.digest !== fingerprint) return finish("BLOCKED", "idempotency-conflict");
      return verify();
    }

    const previous = recover();
    if (previous) return previous;
    if (getDraft.get(key)) return finish("BLOCKED", "duplicate-draft");
    states.push("AWAITING_APPROVAL");
    interventions++;
    const binding = digest({ bot, machine, actor, company, key, fingerprint, workflow: trustedDigest });
    const decision = await waitForApproval(approve, binding, signal);
    if (decision.reason) return finish("BLOCKED", decision.reason);
    if (!permitted()) return finish("BLOCKED", signal?.aborted ? "stopped" : "permission");
    if (decision.proof !== binding) return finish("BLOCKED", "approval-required");

    try {
      if (reserve.run(key, fingerprint).changes !== 1) return recover() ?? finish("UNKNOWN", "reservation-unavailable");
    } catch {
      return finish("UNKNOWN", "reservation-unavailable");
    }
    if (getDraft.get(key)) return finish("BLOCKED", "duplicate-draft");
    states.push("EXECUTING");
    writeAttempts++;
    try { persist(structuredClone(draft), key, fault); } catch { /* Dispatch may have changed the fixture. */ }
    if (fault === "readback-unavailable") {
      states.push("VERIFYING");
      return finish("UNKNOWN", "read-back-unavailable");
    }
    return verify();
  }

  return {
    adapter, run,
    count: () => count.get().count,
    addExistingDraft(voucher) {
      const { expected } = validateVoucher(voucher);
      if (!expected) throw new Error("invalid synthetic draft");
      putDraft.run(identity(expected), JSON.stringify(expected));
    },
    close: () => db.close(),
  };
}

export function openAccountingFixture() {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-accounting-"));
  const database = join(directory, "fixture.sqlite");
  const connections = new Set();
  return {
    connect() {
      const connection = runner(connect(database));
      connections.add(connection);
      return { ...connection, close() { if (connections.delete(connection)) connection.close(); } };
    },
    dispose() {
      for (const connection of connections) connection.close();
      connections.clear();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function mockScope(company = "DEMO-A") {
  return { bot: "fixture-bot", machine: "fixture-machine", actor: "fixture-user", company };
}

export function mockGrant(scope, now = Date.now()) {
  return { ...scope, adapter: workflow.adapter, permission: capability, workflowDigest: trustedDigest, revoked: false, expiresAt: now + 60_000 };
}
