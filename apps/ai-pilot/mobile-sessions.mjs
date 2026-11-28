import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { digest, Fault } from "./ledger.mjs";

const name = "__Host-startupbot-mobile";
const flags = "; Path=/; HttpOnly; SameSite=Strict; Secure";
const lifetime = 8 * 3600;

export function mobileSessions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS mobile_sessions(handle TEXT PRIMARY KEY,owner TEXT NOT NULL,sealed BLOB NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS mobile_session_expiry ON mobile_sessions(expires)`);
  function issue(res, owner, bearer) {
    const secret = randomBytes(32), handle = secret.toString("base64url"), iv = randomBytes(12);
    // A database backup cannot decrypt an issuer token without the browser's random session secret.
    const cipher = createCipheriv("aes-256-gcm", secret, iv);
    cipher.setAAD(Buffer.from(owner));
    const sealed = Buffer.concat([iv, cipher.update(bearer, "utf8"), cipher.final(), cipher.getAuthTag()]);
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
    const data = Buffer.from(row.sealed);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(handle, "base64url"), data.subarray(0,12));
    decipher.setAAD(Buffer.from(row.owner));
    decipher.setAuthTag(data.subarray(-16));
    const token = Buffer.concat([decipher.update(data.subarray(12,-16)), decipher.final()]).toString("utf8");
    return { hash, token, owner:row.owner };
  }
  function revoke(res, hash) {
    db.prepare("DELETE FROM mobile_sessions WHERE handle=?").run(hash);
    res.setHeader("Set-Cookie", name + "=" + flags + "; Max-Age=0");
  }
  return { issue, read, revoke };
}
