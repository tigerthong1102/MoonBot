import type { DatabaseSync } from "node:sqlite";
import type { Message } from "./store.ts";
import type { WorkOrigin } from "./peer-provenance.ts";
import type { UsageTrigger } from "./usage-ledger.ts";
import type { ResolvedSender, SteerQueueReason } from "../shared/wire.ts";
import { bindWorkBotMessageUploads, queuedUploadMessage } from "./work-bot-upload-context.ts";

export interface FollowupPayload {
  workBotUploadNonce?: string;
  text: string;
  prompt?: string;
  replyToId?: string;
  sendId?: string;
  dataContext?: Message["dataContext"];
  reason?: SteerQueueReason;
  unattended?: boolean;
  peerAsk?: Message["peerAsk"];
  mode?: "chat" | "goal";
  via?: "api" | "call";
  callId?: string;
  fromApp?: Message["fromApp"];
  sender?: ResolvedSender;
  trigger?: UsageTrigger;
  origin?: WorkOrigin;
  queuedAt?: number;
  twinReply?: import("./channel-queue.ts").QueuedTwinReply;
  rowId?: string; mentions?: string[]; workBotOfferOwner?: string; workBotOfferSource?: string; workBotFollowUp?: import("../shared/follow-up.ts").FollowUp;
}
export type FollowupStatus = "pending" | "dispatching" | "interrupted" | "cancelled" | "transferred";
export interface ChatFollowup {
  id: string;
  kind: "bot" | "channel" | "aside";
  ownerId: string;
  threadId: string;
  status: FollowupStatus;
  payload: FollowupPayload;
}

export function createChatFollowupDb(db: () => DatabaseSync, writeFollowups: (write: (connection: DatabaseSync) => void) => void) {
  function saveChatFollowup(followup: Omit<ChatFollowup, "status">): void {
    writeFollowups((connection) => {
      if (followup.kind === "bot" && !followup.payload.rowId) {
        const message = queuedUploadMessage(followup.id, followup.payload);
        bindWorkBotMessageUploads(connection, followup.threadId, message);
        if (message.workBotUploadNonce) followup.payload.workBotUploadNonce = message.workBotUploadNonce;
      }
      connection.prepare("INSERT INTO chat_followups(id, kind, owner_id, thread_id, send_id, status, payload) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(followup.id, followup.kind, followup.ownerId, followup.threadId, followup.payload.sendId ?? null, JSON.stringify(followup.payload));
    });
  }

  /** Cancellation tombstones remain so a retried sendId cannot resurrect a dispatch. */
  function settleChatFollowups(ids: string[], status: FollowupStatus | null): void {
    if (!ids.length) return;
    writeFollowups((connection) => {
      const statement = connection.prepare(status === null
        ? "DELETE FROM chat_followups WHERE id = ?"
        : status === "cancelled"
          ? "UPDATE chat_followups SET status = ?, payload = '{\"text\":\"\"}' WHERE id = ?"
          : "UPDATE chat_followups SET status = ? WHERE id = ?");
      for (const id of ids) {
        if (status === "cancelled" || status === null) {
          const queuedId = "queue:" + id;
          connection.prepare("DELETE FROM work_bot_upload_receipts WHERE message_id = ? AND thread_id = (SELECT thread_id FROM chat_followups WHERE id = ? AND kind = 'bot')").run(queuedId, id);
          connection.prepare("DELETE FROM work_bot_message_upload_sets WHERE message_id = ? AND thread_id = (SELECT thread_id FROM chat_followups WHERE id = ? AND kind = 'bot')").run(queuedId, id);
        }
        if (status === null) statement.run(id);
        else statement.run(status, id);
      }
    });
  }

  function chatFollowups(kind?: ChatFollowup["kind"]): ChatFollowup[] {
    const rows = (kind
      ? db().prepare("SELECT * FROM chat_followups WHERE kind = ? ORDER BY rowid").all(kind)
      : db().prepare("SELECT * FROM chat_followups ORDER BY rowid").all()) as Array<{
        id: string; kind: ChatFollowup["kind"]; owner_id: string; thread_id: string; status: FollowupStatus; payload: string;
      }>;
    return rows.map((row) => ({ id: row.id, kind: row.kind, ownerId: row.owner_id, threadId: row.thread_id,
      status: row.status, payload: JSON.parse(row.payload) as FollowupPayload }));
  }

  function cancelledChatFollowup(kind: ChatFollowup["kind"], ownerId: string, threadId: string, sendId: string): boolean {
    return Boolean(db().prepare(
      "SELECT 1 FROM chat_followups WHERE kind = ? AND owner_id = ? AND thread_id = ? AND send_id = ? AND status = 'cancelled'",
    ).get(kind, ownerId, threadId, sendId));
  }
  return { saveChatFollowup, settleChatFollowups, chatFollowups, cancelledChatFollowup };
}
