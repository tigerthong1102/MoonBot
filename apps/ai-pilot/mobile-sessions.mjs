import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { digest, Fault } from "./ledger.mjs";

const name = "__Host-startupbot-mobile";
const flags = "; Path=/; HttpOnly; SameSite=Strict; Secure";
const lifetime = 8 * 3600;

export function seal(secret, scope, value) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secret, iv);
  cipher.setAAD(Buffer.from(scope));
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
}
export function open(secret, scope, sealed) {
  const data = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", secret, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString("utf8");
}

export function mobileSessions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS mobile_sessions(handle TEXT PRIMARY KEY,owner TEXT NOT NULL,sealed BLOB NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS mobile_session_expiry ON mobile_sessions(expires)`);
  function issue(res, owner, bearer) {
    const secret = randomBytes(32), handle = secret.toString("base64url");
    // A database backup cannot decrypt an issuer token without the browser's random session secret.
    const sealed = seal(secret, owner, bearer);
    db.prepare("DELETE FROM mobile_sessions WHERE expires<=?").run(Date.now());
    db.prepare("INSERT INTO mobile_sessions VALUES (?,?,?,?)").run(digest(handle), owner, sealed, Date.now() + lifetime * 1000);
    res.setHeader("Set-Cookie", name + "=" + handle + flags + "; Max-Age=" + lifetime);
  }
  function read(req) {
    const handle = req.headers.cookie?.split(/;\s*/).find(value => value.startsWith(name + "="))?.slice(name.length + 1);
    if (!handle || !/^[\w-]{43}$/.test(handle)) throw new Fault(401, "signed_out");
    const hash = digest(handle);
    const row = db.prepare("SELECT owner,sealed FROM mobile_sessions WHERE handle=? AND expires>?").get(hash, Date.now());
    if (!row) throw new Fault(401, "signed_out");
    const secret = Buffer.from(handle, "base64url"), owner = row.owner;
    return {
      hash, owner, token: open(secret, owner, row.sealed),
      seal: (purpose, value) => seal(secret, JSON.stringify([owner, purpose]), value),
      open: (purpose, value) => open(secret, JSON.stringify([owner, purpose]), value),
    };
  }
  function revoke(res, hash) {
    db.prepare("DELETE FROM mobile_sessions WHERE handle=?").run(hash);
    res.setHeader("Set-Cookie", name + "=" + flags + "; Max-Age=0");
  }
  return { issue, read, revoke };
}
