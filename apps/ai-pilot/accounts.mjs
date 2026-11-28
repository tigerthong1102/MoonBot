import { randomBytes } from "node:crypto";
import { createControlPlaneClient, normalizeAccountEmail } from "../../electron/control-plane-client.mjs";
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
  let identity, issuerSession;
  try {
    const { accountToken } = await client.verifyOTP(email, body.otp);
    identity = await client.me(accountToken);
    issuerSession = await client.currentAccountSessionId(accountToken);
  } catch {
    throw new Fault(401, "invalid_pilot_sign_in");
  }
  if (identity.id !== invited.owner || identity.email !== email) throw new Fault(401, "invalid_pilot_sign_in");
  const token = "sbpilot_session_" + randomBytes(32).toString("base64url");
  ledger.tx(() => {
    if (generation() !== initialGeneration || !ledger.db.prepare("SELECT 1 FROM invites WHERE owner=? AND email=?").get(identity.id, email))
      throw new Fault(401, "invalid_pilot_sign_in");
    ledger.db.prepare("DELETE FROM wallet_sessions WHERE expires<=?").run(Date.now());
    ledger.db
      .prepare("INSERT INTO wallet_sessions VALUES (?,?,?)")
      .run(digest(token), identity.id, Date.now() + 8 * 3600000);
    ledger.db.prepare("INSERT INTO wallet_issuer_sessions VALUES (?,?)").run(digest(token), issuerSession);
  });
  return { token };
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
