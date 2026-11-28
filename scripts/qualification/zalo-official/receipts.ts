import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { zaloWrite } from "../../../server/zalo-write.ts";

export function claimLabAccount(db: DatabaseSync, accountId: string, now: number, until: number) {
  db.exec(`CREATE TABLE IF NOT EXISTS lab_key (id INTEGER PRIMARY KEY CHECK(id=1), secret BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS lab_lease (account TEXT PRIMARY KEY, nonce TEXT NOT NULL, until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS lab_receipt (account TEXT NOT NULL, sample TEXT NOT NULL, confirmed INTEGER NOT NULL,
      PRIMARY KEY(account, sample));`);
  db.prepare("INSERT OR IGNORE INTO lab_key VALUES (1, ?)").run(randomBytes(32));
  const row = db.prepare("SELECT secret FROM lab_key WHERE id=1").get() as { secret: Uint8Array };
  const digest = (...parts: string[]) => createHmac("sha256", row.secret).update(JSON.stringify(parts)).digest("hex");
  const account = digest("bot", accountId);
  const nonce = randomUUID();
  const claimed = zaloWrite(db, () => {
    if (db.prepare("SELECT 1 FROM lab_receipt WHERE account=? AND confirmed=0").get(account)) return false;
    return db.prepare(`INSERT INTO lab_lease VALUES (?,?,?) ON CONFLICT(account)
      DO UPDATE SET nonce=excluded.nonce, until=excluded.until WHERE lab_lease.until<=?`)
      .run(account, nonce, until, now).changes === 1;
  });
  if (!claimed) return;
  return {
    arm(chat: string, sender: string, message: string, at: number) {
      const sample = digest("sample", accountId, chat, sender, message);
      const reserved = zaloWrite(db, () => {
        if (!db.prepare("SELECT 1 FROM lab_lease WHERE account=? AND nonce=? AND until>?").get(account, nonce, at)) return false;
        return db.prepare("INSERT OR IGNORE INTO lab_receipt VALUES (?,?,0)").run(account, sample).changes === 1;
      });
      if (!reserved) return;
      return () => { db.prepare("UPDATE lab_receipt SET confirmed=1 WHERE account=? AND sample=?").run(account, sample); };
    },
    release() { db.prepare("DELETE FROM lab_lease WHERE account=? AND nonce=?").run(account, nonce); },
  };
}
