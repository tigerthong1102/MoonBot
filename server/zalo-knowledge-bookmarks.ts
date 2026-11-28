import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { holdsCredential, redactSecretsInText } from "../shared/redact.ts";
import { ZALO_PRIVATE_KNOWLEDGE_MARKER, type ZaloKnowledgeItem } from "../shared/zalo-knowledge-bookmarks.ts";
import { zaloWrite } from "./zalo-write.ts";

type Row = Omit<ZaloKnowledgeItem, "saved" | "revision"> & { version: number; saved: number };
type Choice = Pick<ZaloKnowledgeItem, "grantId" | "sourceId" | "revision"> & { save: boolean };

export function zaloKnowledgeBookmarks(db: DatabaseSync, account: string, workspace: string, now = Date.now) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS zalo_knowledge_bookmarks (
      workspace TEXT NOT NULL, grantId TEXT NOT NULL REFERENCES zalo_grants ON DELETE CASCADE,
      sourceId TEXT NOT NULL, version INTEGER NOT NULL, saved INTEGER NOT NULL,
      PRIMARY KEY(workspace,grantId,sourceId));
    CREATE TRIGGER IF NOT EXISTS zalo_forget_knowledge AFTER DELETE ON zalo_events BEGIN
      DELETE FROM zalo_knowledge_bookmarks WHERE grantId=OLD.grantId AND sourceId=OLD.messageId;
    END`);
  const prefix = ZALO_PRIVATE_KNOWLEDGE_MARKER + "\n";
  const source = `SELECT e.messageId AS sourceId,g.grantId,g.conversationId,g.senderId,
    substr(e.text,length($prefix)+1) AS quote,e.timestamp,e.expires,
    COALESCE(b.version,0) AS version,COALESCE(b.saved,0) AS saved
    FROM zalo_webhook_endpoints p JOIN zalo_grants g ON p.grantId=g.grantId AND p.accountId=g.accountId
    JOIN zalo_events e ON e.grantId=g.grantId AND e.accountId=g.accountId AND e.conversationId=g.conversationId
    LEFT JOIN zalo_knowledge_bookmarks b ON b.workspace=$workspace AND b.grantId=g.grantId AND b.sourceId=e.messageId
    WHERE p.accountId=$account AND g.adapter='official' AND g.conversationType='direct'
      AND e.adapter='official' AND e.conversationType='direct' AND e.direction='incoming'
      AND e.timestamp>=g.since AND e.expires>$now AND substr(e.text,1,length($prefix))=$prefix
      AND length(e.text)-length($prefix) BETWEEN 1 AND 1000`;
  const args = () => ({ workspace, account, prefix, now: now() });
  function item(row: Row): ZaloKnowledgeItem | undefined {
    const { version, saved, ...value } = row;
    if (!value.quote.trim() || holdsCredential(value.quote) || redactSecretsInText(value.quote) !== value.quote) return;
    const revision = createHash("sha256")
      .update(JSON.stringify([workspace, account, value, version]))
      .digest("hex");
    return { ...value, saved: saved === 1, revision };
  }
  return {
    list() {
      const read = db.prepare(
        source + " AND COALESCE(b.saved,0)=$saved ORDER BY e.timestamp DESC,e.messageId DESC LIMIT 20",
      );
      const bindings = args();
      return [1, 0].flatMap((saved) => (read.all({ ...bindings, saved }) as Row[]).flatMap((row) => item(row) ?? []));
    },
    choose(choice: Choice) {
      return zaloWrite(db, () => {
        const row = db
          .prepare(source + " AND g.grantId=$grant AND e.messageId=$id")
          .get({ ...args(), grant: choice.grantId, id: choice.sourceId }) as Row | undefined;
        const current = row && item(row);
        if (!current || current.revision !== choice.revision || current.saved === choice.save) return false;
        db.prepare(
          `INSERT INTO zalo_knowledge_bookmarks VALUES(?,?,?,1,?)
          ON CONFLICT(workspace,grantId,sourceId) DO UPDATE SET version=version+1,saved=excluded.saved`,
        ).run(workspace, current.grantId, current.sourceId, Number(choice.save));
        return true;
      });
    },
  };
}
