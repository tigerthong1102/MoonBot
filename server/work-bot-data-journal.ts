import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DataCard } from "../shared/data-surface.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/);
const linkSchema = z.object({ sourceBotId: key, sourceThreadId: key, sourceMessageId: key, targetBotId: key, targetThreadId: key });
const cardSchema = z.object({
  id: z.string().regex(/^c_[1-9]\d*$/), kind: z.enum(["table", "chart", "text"]), title: z.string(),
  status: z.literal("ready"), by: z.literal("person"), createdAt: z.string(), updatedAt: z.string(),
  sql: z.string().optional(), result: z.string().optional(),
}).passthrough();
const entrySchema = z.object({ op: z.string().regex(/^[0-9a-f]{32}$/), link: linkSchema, cards: z.array(cardSchema).min(1).max(200) });
export type WorkBotDataEntry = { op: string; link: WorkBotLink; cards: DataCard[] };
export function dataSnapshotNames(op: string, index: number) {
  if (!/^[0-9a-f]{32}$/.test(op) || !Number.isInteger(index) || index < 0 || index >= 200) throw new Error("Invalid Data snapshot name");
  return { backing: `snapshot_${op}_${index}`, result: `display_${op}_${index}` };
}
function entryFrom(value: unknown): WorkBotDataEntry {
  const entry = entrySchema.parse(value);
  if (entry.link.targetBotId === entry.link.sourceBotId || entry.link.targetThreadId === entry.link.sourceThreadId || new Set(entry.cards.map(card => card.id)).size !== entry.cards.length) throw new Error("Invalid Data handoff journal");
  entry.cards.forEach((card, index) => {
    const { result, backing } = dataSnapshotNames(entry.op, index);
    if (card.kind === "text" ? card.result !== undefined || card.sql !== undefined : card.result !== result || card.sql !== `SELECT * FROM omb_results."${backing}"`) throw new Error("Invalid Data handoff card");
  });
  return entry as WorkBotDataEntry;
}

const KIND = "work-bot-data-pending-v1";
export function createWorkBotDataJournal(db: () => DatabaseSync, durable: (write: (database: DatabaseSync) => void) => void) {
  return {
    pending(): WorkBotDataEntry[] {
      return db().prepare("SELECT key, result FROM command_receipts WHERE kind = ?").all(KIND).map(row => {
        const entry = entryFrom(JSON.parse(String(row.result)));
        if (entry.op !== row.key) throw new Error("Invalid Data handoff journal key");
        return entry;
      });
    },
    begin(value: WorkBotDataEntry) {
      const entry = entryFrom(value);
      durable(database => database.prepare("INSERT INTO command_receipts (kind, key, at, result) VALUES (?, ?, ?, ?)").run(KIND, entry.op, Date.now(), JSON.stringify(entry)));
    },
    /** Checkpoint the chat write in a FULL-sync transaction before publishing the sheet in another file. */
    fence(op: string): boolean {
      let pending = false;
      durable(database => { pending = database.prepare("UPDATE command_receipts SET at=at+1 WHERE kind=? AND key=?").run(KIND, op).changes === 1; });
      return pending;
    },
    forget(op: string) {
      durable(database => database.prepare("DELETE FROM command_receipts WHERE kind = ? AND key = ?").run(KIND, op));
    },
    committed(link: WorkBotLink): boolean {
      const row = db().prepare(`SELECT EXISTS(SELECT 1 FROM work_bot_links WHERE source_bot_id=?1 AND source_thread_id=?2 AND source_message_id=?3 AND target_bot_id=?4 AND target_thread_id=?5) AS linked,
        EXISTS(SELECT 1 FROM messages WHERE thread_id=?5 AND role='user' AND json_extract(json,'$.sendId')='workbot-' || ?3 AND json_extract(json,'$.workBotHandoffSource.botId')=?1 AND json_extract(json,'$.workBotHandoffSource.threadId')=?2 AND json_extract(json,'$.workBotHandoffSource.messageId')=?3) AS sent`)
        .get({ "1": link.sourceBotId, "2": link.sourceThreadId, "3": link.sourceMessageId, "4": link.targetBotId, "5": link.targetThreadId });
      if (!row || row.linked !== row.sent) throw new Error("Data handoff commit is uncertain");
      return Boolean(row.linked);
    },
  };
}
export type WorkBotDataJournal = ReturnType<typeof createWorkBotDataJournal>;
