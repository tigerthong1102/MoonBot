import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ZaloReplyPreview, ZaloReplySource } from "../shared/zalo-approved-send.ts";
import { claimZaloSendAccount, zaloSendLedger } from "./zalo-send-receipts.ts";
import { sendZaloPrivateText, verifyZaloOfficialIdentity } from "./zalo-official.ts";
import { zaloWrite } from "./zalo-write.ts";

type SourceKey = Pick<ZaloReplySource, "grantId" | "sourceId">;
type Action = { actionId: string; digest: string; expires: number; state: "pending" | "unknown" | "acknowledged" };
export type ApproveReply = SourceKey & Pick<ZaloReplyPreview, "actionId" | "digest" | "text">;
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export function createZaloReplyStore(db: DatabaseSync, accountId: string, allowed: () => boolean, now = Date.now) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS zalo_reply_actions (
      grantId TEXT REFERENCES zalo_grants ON DELETE CASCADE, sourceId TEXT, actionId TEXT NOT NULL UNIQUE,
      digest TEXT NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL, receiptId TEXT, PRIMARY KEY(grantId,sourceId));
    CREATE TRIGGER IF NOT EXISTS zalo_forget_reply AFTER DELETE ON zalo_events BEGIN
      DELETE FROM zalo_reply_actions WHERE grantId=OLD.grantId AND sourceId=OLD.messageId;
    END`);
  const ledger = zaloSendLedger(db, accountId);
  function source(key?: SourceKey) {
    if (!allowed()) return;
    const row = db.prepare(`SELECT g.grantId,g.accountId,g.senderId,g.conversationId,e.messageId AS sourceId,
      e.timestamp AS sourceTime,e.text AS sourceText,e.expires AS sourceExpires,a.state,a.receiptId
      FROM zalo_webhook_endpoints p JOIN zalo_grants g ON g.grantId=p.grantId AND g.accountId=p.accountId
      JOIN zalo_events e ON e.grantId=g.grantId AND e.accountId=g.accountId AND e.conversationId=g.conversationId
      LEFT JOIN zalo_reply_actions a ON a.grantId=g.grantId AND a.sourceId=e.messageId
      WHERE p.accountId=? AND g.adapter='official' AND g.conversationType='direct' AND e.adapter='official'
        AND e.conversationType='direct' AND e.direction='incoming' AND e.expires>? AND e.timestamp>=g.since
        ${key ? "AND g.grantId=? AND e.messageId=?" : ""}
      ORDER BY e.timestamp DESC,e.messageId DESC LIMIT 1`).get(accountId, now(), ...(key ? [key.grantId, key.sourceId] : []));
    if (!row) return;
    const { state, receiptId, ...scope } = row;
    return { ...scope, accountHeld: ledger.held(), ...(state === "unknown" || state === "acknowledged" ? { delivery: state } : {}),
      ...(typeof receiptId === "string" ? { receiptId } : {}) } as unknown as ZaloReplySource;
  }
  const digestFor = (id: string, s: ZaloReplySource, text: string, until: number) => hash([
    "official-private-owner-text-v1", id, s.accountId, s.grantId, s.senderId, s.conversationId,
    s.sourceId, s.sourceTime, hash([s.sourceText]), text, [], until,
  ]);
  function checked(input: ApproveReply) {
    const current = source(input);
    const action = db.prepare("SELECT actionId,digest,expires,state FROM zalo_reply_actions WHERE grantId=? AND sourceId=?")
      .get(input.grantId, input.sourceId) as Action | undefined;
    if (!current || !action || current.accountHeld || current.delivery || action.state !== "pending" || action.expires <= now() ||
        action.actionId !== input.actionId || action.digest !== input.digest ||
        digestFor(action.actionId, current, input.text, action.expires) !== action.digest) return;
    return { current, action };
  }
  return {
    source,
    preview(key: SourceKey, text: string): ZaloReplyPreview | undefined {
      if (!text.trim() || text.length > 2000 || /[\p{Cf}\p{Cs}]/u.test(text) ||
          Array.from(text).some(c => c !== "\n" && c !== "\t" && /\p{Cc}/u.test(c))) return;
      return zaloWrite(db, () => {
        const current = source(key);
        if (!current || current.accountHeld || current.delivery) return;
        const actionId = randomUUID(), expires = Math.min(current.sourceExpires, now() + 5 * 60_000);
        const digest = digestFor(actionId, current, text, expires);
        db.prepare(`INSERT OR REPLACE INTO zalo_reply_actions(grantId,sourceId,actionId,digest,expires,state)
          VALUES(?,?,?,?,?,'pending')`).run(key.grantId, key.sourceId, actionId, digest, expires);
        return { actionId, digest, expires, text, source: current };
      });
    },
    async send(input: ApproveReply, token: string, signal: AbortSignal, request: typeof fetch = fetch) {
      if (!checked(input) || signal.aborted) return { status: "changed" } as const;
      try { await verifyZaloOfficialIdentity(token, accountId, signal, request); }
      catch { return { status: "identity-failed" } as const; }
      const reserved = zaloWrite(db, () => {
        const valid = checked(input);
        if (!valid || signal.aborted) return;
        const lease = claimZaloSendAccount(db, accountId, now(), now() + 15_000);
        if (!lease) return;
        const confirm = lease.arm(valid.current.conversationId, valid.current.senderId, valid.current.sourceId, now());
        if (!confirm) { lease.release(); return; }
        db.prepare("UPDATE zalo_reply_actions SET state='unknown' WHERE actionId=?").run(input.actionId);
        return { ...lease, confirm, chatId: valid.current.conversationId };
      });
      if (!reserved) return { status: "changed" } as const;
      try {
        const receipt = await sendZaloPrivateText(token, reserved.chatId, input.text, signal, request);
        return zaloWrite(db, () => {
          reserved.confirm();
          if (!source(input)) return { status: "changed" } as const;
          db.prepare("UPDATE zalo_reply_actions SET state='acknowledged',receiptId=? WHERE actionId=?").run(receipt, input.actionId);
          return { status: "acknowledged", receiptId: receipt } as const;
        });
      } catch { return { status: "unknown" } as const; }
      finally { reserved.release(); }
    },
  };
}
