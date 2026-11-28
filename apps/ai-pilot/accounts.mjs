import { randomBytes } from "node:crypto";
import { ControlPlaneError, createControlPlaneClient, normalizeAccountEmail } from "../../electron/control-plane-client.mjs";
import { open, seal } from "./mobile-sessions.mjs";
import { digest, Fault } from "./ledger.mjs";

export function invite(ledger, owner, address) {
  const email = normalizeAccountEmail(address);
  if (!email || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Fault(400, "invalid_account");
  ledger.tx(() => {
    if (!ledger.db.prepare("SELECT 1 FROM users WHERE id=?").get(owner)) ledger.issue(owner);
    ledger.db
      .prepare(
        "INSERT INTO invites(owner,email) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET email=excluded.email",
      )
      .run(owner, email);
  });
}

export async function accountSignIn(ledger, origin, http, body, verify) {
  if (!origin) throw new Fault(404, "account_sign_in_disabled");
  const email = normalizeAccountEmail(body.email);
  const invited = email && ledger.db.prepare("SELECT owner FROM invites WHERE email=?").get(email);
  if (!invited && verify) throw new Fault(401, "invalid_pilot_sign_in");
  const client = createControlPlaneClient({ baseURL: origin, fetchImpl: http });
  if (!verify) {
    if (invited) await client.requestOTP(email);
    return { ok: true };
  }
  const generation = () => ledger.db.prepare("SELECT generation FROM wallet_session_generations WHERE owner=?").get(invited.owner)?.generation ?? 0;
  const initialGeneration = generation();
  let identity, issuerSession, accountToken;
  try {
    ({ accountToken } = await client.verifyOTP(email, body.otp));
    identity = await client.me(accountToken, { requireVerifiedEmail: true });
    issuerSession = await client.currentAccountSessionId(accountToken);
  } catch {
    throw new Fault(401, "invalid_pilot_sign_in");
  }
  if (identity.id !== invited.owner || identity.email !== email) throw new Fault(401, "invalid_pilot_sign_in");
  const secret = randomBytes(32);
  const token = "sbpilot_session_" + secret.toString("base64url");
  const scope = JSON.stringify(["wallet-issuer", client.origin, identity.id, issuerSession]);
  ledger.tx(() => {
    if (generation() !== initialGeneration || !ledger.db.prepare("SELECT 1 FROM invites WHERE owner=? AND email=?").get(identity.id, email))
      throw new Fault(401, "invalid_pilot_sign_in");
    ledger.db.prepare("DELETE FROM wallet_sessions WHERE expires<=?").run(Date.now());
    ledger.db
      .prepare("INSERT INTO wallet_sessions VALUES (?,?,?)")
      .run(digest(token), identity.id, Date.now() + 8 * 3600000);
    ledger.db.prepare("INSERT INTO wallet_issuer_sessions VALUES (?,?)").run(digest(token), issuerSession);
    ledger.db.prepare("INSERT INTO wallet_issuer_credentials VALUES (?,?,?)")
      .run(digest(token), client.origin, seal(secret, scope, accountToken));
  });
  return { token };
}


export async function validateWalletIssuer(ledger, origin, http, token, owner) {
  const hash = digest(token);
  const row = ledger.db.prepare(`SELECT i.issuerSession,c.origin,c.sealed FROM wallet_issuer_sessions i
    JOIN wallet_issuer_credentials c ON c.wallet=i.wallet WHERE i.wallet=?`).get(hash);
  const reject = () => {
    ledger.db.prepare("DELETE FROM wallet_sessions WHERE token=? AND owner=?").run(hash, owner);
    throw new Fault(401, "invalid_pilot_token");
  };
  // Tokens issued before sealing was introduced require a new email sign-in.
  if (!row) reject();
  const client = createControlPlaneClient({ baseURL: origin, fetchImpl: http });
  if (client.origin !== row.origin) throw new Fault(503, "account_unavailable");
  const secret = Buffer.from(token.slice("sbpilot_session_".length), "base64url");
  const scope = JSON.stringify(["wallet-issuer", row.origin, owner, row.issuerSession]);
  const accountToken = open(secret, scope, row.sealed);
  try {
    const user = await client.me(accountToken, { requireVerifiedEmail: true });
    if (user.id !== owner) reject();
  } catch (error) {
    if (!(error instanceof ControlPlaneError)) throw error;
    if (error.status === 401 || error.status === 403) reject();
    if (error.status === 429) throw new Fault(429, "account_rate_limit");
    throw new Fault(503, "account_unavailable");
  }
  // A local sign-out may have occurred while the issuer was being checked.
  ledger.authenticate(token);
}

export function revokeWalletSessions(ledger, owner, issuerSession) {
  const db = ledger.db;
  ledger.tx(() => {
    db.prepare(`INSERT INTO wallet_session_generations(owner,generation) SELECT id,1 FROM users WHERE id=?
      ON CONFLICT(owner) DO UPDATE SET generation=generation+1`).run(owner);
    // Before this mapping existed, there was no reliable way to attribute an old wallet bearer to one issuer session.
    db.prepare(`DELETE FROM wallet_sessions WHERE owner=? AND (? IS NULL OR NOT EXISTS (
      SELECT 1 FROM wallet_issuer_sessions i WHERE i.wallet=wallet_sessions.token AND i.issuerSession<>?
    ))`).run(owner, issuerSession, issuerSession);
  });
}
