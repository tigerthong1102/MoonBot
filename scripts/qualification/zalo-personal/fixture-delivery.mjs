import { createHash, randomUUID } from "node:crypto";

const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// Local qualification transport only. No network transport or external send method is accepted.
export function createFixtureDelivery(db, now, afterAcceptance) {
  db.exec(`CREATE TABLE IF NOT EXISTS zalo_fixture_approvals (
    id TEXT PRIMARY KEY, grantId TEXT NOT NULL REFERENCES zalo_grants ON DELETE CASCADE,
    sourceId TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, expires INTEGER NOT NULL,
    state TEXT NOT NULL, UNIQUE(grantId, sourceId)
  )`);
  const match = db.prepare(`SELECT 1 FROM zalo_events e JOIN zalo_grants g ON g.grantId=e.grantId
    WHERE e.grantId=? AND e.messageId=? AND g.adapter='personal' AND g.accountId=? AND
    g.conversationId=? AND g.conversationType=? AND e.expires>? AND e.direction='incoming'`);
  const hasSource = (d) => !!match.get(d.grantId, d.sourceId, d.accountId, d.conversationId, d.conversationType, now());
  function approve(d, expires) {
    if (!hasSource(d) || !Number.isSafeInteger(expires) || expires <= now() || expires > now() + 300_000 ||
        !Number.isSafeInteger(d.revision) || d.revision < 1 || typeof d.text !== "string" || !d.text.trim() || d.text.length > 8000) {
      throw new Error("invalid_approval");
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO zalo_fixture_approvals VALUES(?,?,?,?,?,?,'approved')`)
      .run(id, d.grantId, d.sourceId, d.revision, digest(d.text), expires);
    return id;
  }
  function attempt(id, d) {
    db.exec("BEGIN IMMEDIATE");
    let state = "denied";
    try {
      const row = db.prepare("SELECT * FROM zalo_fixture_approvals WHERE id=?").get(id);
      if (row && row.grantId === d.grantId && row.sourceId === d.sourceId && row.revision === d.revision &&
          typeof d.text === "string" && d.text.length <= 8000 && row.digest === digest(d.text) && hasSource(d)) {
        if (row.state !== "approved") state = row.state;
        else if (row.expires > now()) {
          db.prepare("UPDATE zalo_fixture_approvals SET state='unknown' WHERE id=?").run(id);
          state = "dispatch";
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (state !== "dispatch") return state;
    // An abrupt exit anywhere after the commit leaves a durable unknown result.
    try {
      afterAcceptance();
    } catch {
      return "unknown";
    }
    const saved = db.prepare("UPDATE zalo_fixture_approvals SET state='confirmed' WHERE id=? AND state='unknown'").run(id);
    return saved.changes === 1 ? "confirmed" : "unknown";
  }
  return { approve, attempt };
}
