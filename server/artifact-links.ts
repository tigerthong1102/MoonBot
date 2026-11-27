import { randomBytes } from "node:crypto";
import { mkdirSync, closeSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mediaViewerKey } from "./message-media-links.ts";
import type { RequestAuth } from "./request-auth.ts";

export class ArtifactLinks {
  private db: DatabaseSync | null = null;
  private readonly now: () => number;
  private readonly file: string;
  constructor(now = Date.now, file = ":memory:") { this.now = now; this.file = file; }

  private store() {
    if (this.db) return this.db;
    if (this.file !== ":memory:") {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      closeSync(openSync(this.file, "a", 0o600));
    }
    const db = new DatabaseSync(this.file);
    try {
      db.exec(`PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS artifact_links (
          id TEXT PRIMARY KEY, thread TEXT NOT NULL, message TEXT NOT NULL, path TEXT NOT NULL, owner TEXT NOT NULL,
          expires INTEGER NOT NULL, UNIQUE(thread,message,path,owner));
        CREATE INDEX IF NOT EXISTS artifact_links_expiry ON artifact_links(expires);`);
    } catch (error) { db.close(); throw error; }
    this.db = db;
    return db;
  }

  issue(threadId: string, messageId: string, path: string, auth: RequestAuth) {
    const db = this.store(), now = this.now(), owner = mediaViewerKey(auth);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM artifact_links WHERE expires<=?").run(now);
      const existing = db.prepare("SELECT id, expires AS expiresAt FROM artifact_links WHERE thread=? AND message=? AND path=? AND owner=?").get(threadId,messageId,path,owner);
      let result;
      if (existing) result = { id: String(existing.id), expiresAt: Number(existing.expiresAt) };
      else {
        result = { id: randomBytes(32).toString("base64url"), expiresAt: now + 24 * 60 * 60_000 };
        db.prepare("INSERT INTO artifact_links(id,thread,message,path,owner,expires) VALUES(?,?,?,?,?,?)").run(result.id, threadId, messageId, path, owner, result.expiresAt);
        db.exec("DELETE FROM artifact_links WHERE rowid IN (SELECT rowid FROM artifact_links ORDER BY expires DESC,rowid DESC LIMIT -1 OFFSET 2048)");
      }
      db.exec("COMMIT"); return result;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  read(id: string, threadId: string, messageId: string) {
    const row = this.store().prepare("SELECT path FROM artifact_links WHERE id=? AND thread=? AND message=? AND expires>?").get(id,threadId,messageId,this.now());
    return row ? String(row.path) : null;
  }

  revoke(id: string, threadId: string, messageId: string, auth: RequestAuth) {
    this.store().prepare("DELETE FROM artifact_links WHERE id=? AND thread=? AND message=? AND owner=?").run(id,threadId,messageId,mediaViewerKey(auth));
  }

  close() { this.db?.close(); this.db = null; }
}
