import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ZaloPairingStatus } from "../shared/zalo-pairing.ts";
import { createZaloInbox } from "./zalo-inbox.ts";
import { normalizedOfficialText, ZaloOfficialError } from "./zalo-official.ts";
import { webhookClock, ZALO_WEBHOOK_SKEW_MS } from "./zalo-webhook-clock.ts";
import { zaloWrite } from "./zalo-write.ts";
import { json, readRawBody, type IngressDoor } from "./webhook-ingress.ts";

const digest = (text: string) => createHash("sha256").update(text).digest();
const currentPilot = () => process.env.STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT === "1";
const MAX_ATTEMPTS = 5;
const CHALLENGE_MS = 5 * 60_000;

type Endpoint = { accountId: string; secretHash: Uint8Array; grantId: string | null };
type Pair = { id: string; codeHash: Uint8Array | null; expires: number; started: number; failures: number;
  sender: string | null; chat: string | null; endpoint: string };

/** Owner methods belong to a trusted local operator. Only door is a network handler. */
export function createZaloWebhookPilot(db: DatabaseSync, now: () => number = Date.now) {
  const inbox = createZaloInbox(db, now);
  db.exec(`CREATE TABLE IF NOT EXISTS zalo_pair_challenges (
    id TEXT NOT NULL UNIQUE, endpoint TEXT PRIMARY KEY REFERENCES zalo_webhook_endpoints ON DELETE CASCADE,
    codeHash BLOB, started INTEGER NOT NULL, expires INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0, sender TEXT, chat TEXT
  );
  CREATE TABLE IF NOT EXISTS zalo_pair_failures (
    challenge TEXT NOT NULL REFERENCES zalo_pair_challenges(id) ON DELETE CASCADE,
    messageHash BLOB NOT NULL, PRIMARY KEY(challenge,messageHash)
  )`);
  const endpointById = (id: string) => db.prepare("SELECT accountId,secretHash,grantId FROM zalo_webhook_endpoints WHERE endpoint=?").get(id) as Endpoint | undefined;
  const challenge = (endpoint: string) => db.prepare("SELECT * FROM zalo_pair_challenges WHERE endpoint=?").get(endpoint) as Pair | undefined;
  const clock = webhookClock(db);
  const purgeExpired = () => {
    const time = now();
    clock.prune(time);
    db.prepare("DELETE FROM zalo_pair_challenges WHERE expires<=?").run(time);
  };
  purgeExpired();
  const active = () => { if (!currentPilot()) throw new Error("Zalo webhook pilot disabled"); };
  const authorized = (endpoint: Endpoint | undefined, secret: string) =>
    !!endpoint && /^[A-Za-z0-9_-]{43}$/.test(secret) && timingSafeEqual(endpoint.secretHash, digest(secret));

  function receive(endpointId: string, secret: string, receivedEpoch: string | null, payload: unknown) {
    return zaloWrite(db, () => {
      const endpoint = endpointById(endpointId);
      if (!currentPilot() || !endpoint || !authorized(endpoint, secret)) return 403;
      purgeExpired();
      const event = normalizedOfficialText(endpoint.accountId, payload);
      if (!event) return 204;
      const time = now();
      if (/^\/pair(?:\s|$)/u.test(event.text)) {
        const pair = challenge(endpointId);
        if (!pair || !pair.codeHash || event.timestamp < pair.started) return 204;
        if (event.timestamp > time + ZALO_WEBHOOK_SKEW_MS) return 503;
        const messageHash = digest(JSON.stringify([event.conversationId, event.messageId]));
        if (db.prepare("SELECT 1 FROM zalo_pair_failures WHERE challenge=? AND messageHash=?").get(pair.id, messageHash)) return 204;
        if (pair.failures >= MAX_ATTEMPTS) return 429;
        const code = /^\/pair ([A-Za-z0-9_-]{22})$/.exec(event.text)?.[1];
        if (!code || !timingSafeEqual(pair.codeHash, digest(code))) {
          db.prepare("INSERT INTO zalo_pair_failures(challenge,messageHash) VALUES(?,?)").run(pair.id, messageHash);
          db.prepare("UPDATE zalo_pair_challenges SET failures=failures+1 WHERE id=?").run(pair.id);
          return 204;
        }
        db.prepare("UPDATE zalo_pair_challenges SET codeHash=NULL,sender=?,chat=? WHERE id=?").run(event.senderId, event.conversationId, pair.id);
        return 204;
      }
      const grant = endpoint.grantId ? inbox.grant(endpoint.grantId) : undefined;
      const decision = clock.assess(endpointId, secret, event, grant, receivedEpoch, time);
      if (decision !== undefined) return decision;
      if (!grant) return 204;
      const result = inbox.accept(event, grant.grantId);
      return result === "conflict" ? 409 : 204;
    });
  }

  let inflight = 0;
  const door: IngressDoor = async (req, res, url) => {
    const match = /^\/hooks\/zalo-official\/([A-Za-z0-9_-]{24})$/.exec(url.pathname);
    if (!match) return false;
    const reply = (status: number) => {
      if (status === 503) res.setHeader("Retry-After", "30");
      json(res, status, {});
      return true;
    };
    if (!currentPilot()) return reply(404);
    if (req.method !== "POST") return reply(405);
    const secret = req.headers["x-bot-api-secret-token"];
    if (typeof secret !== "string") return reply(403);
    let receivedEpoch: string | null;
    try {
      const entry = endpointById(match[1]);
      if (!entry || !authorized(entry, secret)) return reply(403);
      receivedEpoch = entry.grantId;
    } catch { return reply(503); }
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") return reply(415);
    if (inflight >= 8) return reply(429);
    inflight++;
    try {
      const raw = await readRawBody(req);
      if (!raw) return reply(400);
      return reply(receive(match[1], secret, receivedEpoch, JSON.parse(raw)));
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof ZaloOfficialError && error.code === "protocol")) return reply(400);
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      return reply(status === 413 ? 413 : status === 400 ? 400 : 503);
    } finally { inflight--; }
  };

  return {
    door,
    purgeExpired() { zaloWrite(db, () => { purgeExpired(); inbox.purgeExpired(); }); },
    register(accountId: string) {
      active();
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(accountId)) throw new Error("Invalid bot identity");
      return zaloWrite(db, () => {
        if (db.prepare("SELECT 1 FROM zalo_poll_leases WHERE accountId=? AND until>?").get(accountId, now()) ||
            db.prepare("SELECT 1 FROM zalo_grants WHERE adapter='official' AND accountId=?").get(accountId)) throw new Error("Account already enrolled");
        const secret = randomBytes(32).toString("base64url"), endpoint = randomBytes(18).toString("base64url");
        db.prepare("INSERT INTO zalo_webhook_endpoints(endpoint,accountId,secretHash) VALUES(?,?,?)").run(endpoint, accountId, digest(secret));
        return { endpoint, path: "/hooks/zalo-official/" + endpoint, secret };
      });
    },
    inspect(accountId: string): { endpoint: string; pairId?: string; status: ZaloPairingStatus } | undefined {
      active();
      return zaloWrite(db, () => {
        purgeExpired();
        const row = db.prepare("SELECT endpoint,grantId FROM zalo_webhook_endpoints WHERE accountId=?").get(accountId) as
          { endpoint: string; grantId: string | null } | undefined;
        if (!row) return;
        const { endpoint, grantId } = row;
        const pair = challenge(endpoint);
        const revision = createHash("sha256").update(JSON.stringify([endpoint, grantId, pair?.id, pair?.sender, pair?.chat])).digest("hex");
        const grant = grantId ? inbox.grant(grantId) : undefined;
        if (grant) {
          const coverage = inbox.coverage(grant.grantId)!;
          return { endpoint, status: {
            state: "paired", accountId, revision, retentionDays: grant.retentionDays,
            participant: { senderId: grant.senderId, conversationId: grant.conversationId },
            coverage: { count: coverage.count, first: coverage.first, last: coverage.last, pollGaps: coverage.recentGaps.length,
              timingIssues: coverage.webhookTiming?.length ?? 0 },
          } };
        }
        const participant = pair?.sender && pair.chat ? { senderId: pair.sender, conversationId: pair.chat } : undefined;
        return { endpoint, pairId: pair?.id, status: { accountId, revision, participant, expires: pair?.expires,
          state: participant ? "candidate" : !pair ? "ready" : pair.failures >= MAX_ATTEMPTS ? "locked" : "waiting" } };
      });
    },
    invite(endpointId: string) {
      active();
      return zaloWrite(db, () => {
        const endpoint = endpointById(endpointId);
        if (!endpoint || endpoint.grantId) throw new Error("Pairing unavailable");
        const code = randomBytes(16).toString("base64url"), id = randomUUID(), started = now();
        const expires = started + CHALLENGE_MS;
        db.prepare("INSERT OR REPLACE INTO zalo_pair_challenges(id,endpoint,codeHash,started,expires) VALUES(?,?,?,?,?)")
          .run(id, endpointId, digest(code), started, expires);
        return { id, code, expires };
      });
    },
    candidate(endpointId: string) {
      active();
      purgeExpired();
      const pair = challenge(endpointId);
      return pair?.sender && pair.chat ? { id: pair.id, senderId: pair.sender, conversationId: pair.chat } : undefined;
    },
    approve(endpointId: string, expected: { id: string; senderId: string; conversationId: string }, retentionDays: number) {
      active();
      return zaloWrite(db, () => {
        const pair = challenge(endpointId), endpoint = endpointById(endpointId);
        if (!endpoint || endpoint.grantId || !pair || pair.expires <= now() || pair.codeHash || pair.id !== expected.id ||
            !pair.sender || !pair.chat || pair.sender !== expected.senderId || pair.chat !== expected.conversationId) throw new Error("Pairing unavailable");
        const grant = inbox.enroll({ adapter: "official", accountId: endpoint.accountId, conversationId: pair.chat,
          conversationType: "direct", senderId: pair.sender, retentionDays });
        db.prepare("UPDATE zalo_webhook_endpoints SET grantId=? WHERE endpoint=?").run(grant, endpointId);
        db.prepare("DELETE FROM zalo_pair_challenges WHERE endpoint=?").run(endpointId);
        return grant;
      });
    },
    remove(endpointId: string) {
      return zaloWrite(db, () => {
        const endpoint = endpointById(endpointId);
        if (endpoint?.grantId) inbox.revoke(endpoint.grantId);
        return Number(db.prepare("DELETE FROM zalo_webhook_endpoints WHERE endpoint=?").run(endpointId).changes);
      });
    },
  };
}
