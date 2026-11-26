import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_LIMITS, type DataCard } from "../shared/data-surface.ts";
import type { DataContext } from "../shared/data-context.ts";
import { DATA_DIR } from "./config.ts";
import type { DataSheetRegistry } from "./data/sheet.ts";
import { resultRelation } from "./data/tools.ts";
import type { BotDatabase, DataEngine } from "./data/types.ts";
import { dataSnapshotNames, type WorkBotDataEntry, type WorkBotDataJournal } from "./work-bot-data-journal.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";

async function materializedCard(db: BotDatabase, card: DataCard, name: string, signal: AbortSignal) {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name)) throw new Error("Invalid Data result");
  const options = { connection: "panel" as const, signal, timeoutMs: DATA_LIMITS.sqlTimeoutMs, maxRows: 1 };
  const exists = await db.run(`SELECT 1 FROM information_schema.tables WHERE table_catalog=current_database() AND table_schema='omb_results' AND table_name='${name}' AND table_type='BASE TABLE' LIMIT 1`, options);
  if (!exists.rows.length) throw new Error("Materialized Data result is missing");
  const table = resultRelation(name);
  const columns = (await db.run(`SELECT * FROM ${table} LIMIT 0`, options)).columns;
  const limit = card.kind === "chart" ? DATA_LIMITS.chartMaxMarks : DATA_LIMITS.showTableRowsMax;
  const count = await db.run(`SELECT count(*) FROM (SELECT 1 FROM ${table} LIMIT ${limit + 1})`, options);
  const rowCount = Number(count.rows[0]?.[0]);
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount > limit || (card.rowCount !== undefined && rowCount !== card.rowCount) ||
      (card.columns && (card.columns.length !== columns.length || card.columns.some((column, index) => column.name !== columns[index]?.name || column.type !== columns[index]?.type)))) {
    throw new Error("Data result differs from its card");
  }
  return { columns, rowCount };
}

export function createWorkBotData(engine: DataEngine, sheets: DataSheetRegistry, allowed: () => boolean, journal: WorkBotDataJournal) {
  let recoveryBlocked = false;
  const profile = createHash("sha256").update(DATA_DIR).digest("hex").slice(0, 16);
  const directory = (op: string) => join(tmpdir(), `startupbot-data-${profile}-${op}`);
  function clearTemporaryFile(op: string) {
    const path = directory(op);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid temporary Data handoff directory");
    rmSync(join(path, "result.parquet"), { force: true });
    rmdirSync(path);
  }
  function available(botId: string, cardId: string): DataCard | undefined {
    if (recoveryBlocked || !allowed() || engine.unavailable() !== null) return;
    const card = sheets.for(botId).card(cardId);
    if (card?.status === "ready" && (card.kind === "text" || ((card.kind === "chart" || card.kind === "table") && card.result && /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(card.result)))) return card;
  }
  async function preflight(botId: string, ids: readonly string[]): Promise<boolean> {
    const unique = [...new Set(ids)];
    if (unique.length > DATA_LIMITS.sheetCardsMax) return false;
    const signal = AbortSignal.timeout(DATA_LIMITS.sqlTimeoutMs);
    try {
      for (const id of unique) {
        const card = available(botId, id);
        if (!card) return false;
        const original = JSON.stringify(card);
        if (card.result) await materializedCard(await engine.forBot(botId), card, card.result, signal);
        if (JSON.stringify(available(botId, id)) !== original) return false;
      }
      return true;
    } catch { return false; }
  }
  function publish(entry: WorkBotDataEntry) {
    if (!journal.committed(entry.link) || !allowed()) throw new Error("Cannot publish an unconfirmed Data handoff");
    if (!journal.checkpointPendingCopy(entry.op)) return;
    const backing: Record<string, string> = {};
    entry.cards.forEach((card, index) => { if (card.result) backing[card.id] = dataSnapshotNames(entry.op, index).backing; });
    sheets.for(entry.link.targetBotId).publishWorkBotCards(entry.op, entry.cards, backing);
    journal.forget(entry.op);
  }
  async function settle(entry: WorkBotDataEntry) {
    clearTemporaryFile(entry.op);
    if (journal.committed(entry.link)) {
      if (!allowed()) throw new Error("Data handoff is unavailable");
      const sheet = sheets.for(entry.link.targetBotId);
      const published = sheet.publishedWorkBotData(entry.op);
      const signal = AbortSignal.timeout(DATA_LIMITS.sqlTimeoutMs);
      for (const [index, card] of entry.cards.entries()) {
        if (!card.result) continue;
        const current = published ? sheet.card(card.id) : card;
        if (!current) continue;
        const db = await engine.forBot(entry.link.targetBotId);
        if (current.result === card.result) await materializedCard(db, card, card.result, signal);
        if (current.sql === card.sql) await materializedCard(db, card, dataSnapshotNames(entry.op, index).backing, signal);
      }
      return publish(entry);
    }
    if (sheets.for(entry.link.targetBotId).publishedWorkBotData(entry.op)) throw new Error("Published Data handoff commit is uncertain");
    for (const [index, card] of entry.cards.entries()) {
      if (!card.result) continue;
      const target = await engine.forBot(entry.link.targetBotId);
      const names = dataSnapshotNames(entry.op, index);
      await target.dropResult(names.result, "panel");
      await target.dropResult(names.backing, "panel");
    }
    journal.forget(entry.op);
  }
  async function copy(link: WorkBotLink, ids: string[], check: () => void) {
    check();
    if (recoveryBlocked || !allowed() || link.targetBotId === link.sourceBotId || journal.committed(link)) throw new Error("Data handoff is unavailable");
    const op = randomUUID().replaceAll("-", "");
    const unique = [...new Set(ids)];
    const target = sheets.for(link.targetBotId);
    const now = new Date().toISOString();
    const source = unique.map(id => {
      const card = available(link.sourceBotId, id);
      if (!card) throw new Error("Source Data card is unavailable");
      return structuredClone(card);
    });
    const snapshots = source.map(card => JSON.stringify(card));
    const mapping = new Map<string, string>();
    const validate = () => {
      check();
      if (!allowed() || target.cards().length + unique.length > DATA_LIMITS.sheetCardsMax) throw new Error("Data handoff is unavailable");
      source.forEach((card, index) => {
        if (JSON.stringify(available(link.sourceBotId, card.id)) !== snapshots[index]) throw new Error("Source Data card changed during handoff");
      });
    };
    validate();
    const signal = AbortSignal.timeout(DATA_LIMITS.sqlTimeoutMs);
    const shapes = new Map<string, Awaited<ReturnType<typeof materializedCard>>>();
    for (const card of source) {
      if (card.result) shapes.set(card.id, await materializedCard(await engine.forBot(link.sourceBotId), card, card.result, signal));
    }
    validate();
    const cards = source.map((card, index): DataCard => {
      const id = target.nextResultName("c");
      mapping.set(card.id, id);
      const { result, backing } = dataSnapshotNames(op, index);
      return {
        id, title: card.title, kind: card.kind, by: "person", status: "ready", createdAt: now, updatedAt: now,
        ...(card.kind === "text" ? { text: card.text } : {
          result, sql: `SELECT * FROM ${resultRelation(backing)}`, ...shapes.get(card.id), truncated: card.truncated,
          vegaLite: card.vegaLite, reduction: card.reduction,
        }),
      };
    });
    const entry = { op, link, cards };
    journal.begin(entry);
    try {
      if (source.some(card => card.result)) {
        mkdirSync(directory(op), { mode: 0o700 });
        const path = join(directory(op), "result.parquet");
        const file = "'" + path.replaceAll("'", "''") + "'";
        const sourceDb = await engine.forBot(link.sourceBotId);
        const targetDb = await engine.forBot(link.targetBotId);
        const options = { connection: "panel" as const };
        for (const [index, card] of source.entries()) {
          if (card.kind === "text" || !card.result) continue;
          validate();
          await sourceDb.run(`COPY (SELECT * FROM ${resultRelation(card.result)}) TO ${file} (FORMAT PARQUET)`, options);
          validate();
          const names = dataSnapshotNames(op, index);
          const snapshot = await targetDb.materialise(`SELECT * FROM read_parquet(${file})`, names.backing, options);
          const shape = shapes.get(card.id)!;
          if (shape.rowCount !== snapshot.rowCount || JSON.stringify(shape.columns) !== JSON.stringify(snapshot.columns)) throw new Error("Data snapshot differs from its source");
          validate();
          await targetDb.materialise(cards[index]!.sql!, names.result, options);
          rmSync(path);
        }
        clearTemporaryFile(op);
      }
      validate();
      return {
        validate, publish: () => publish(entry), settle: () => settle(entry),
        context(context: DataContext): DataContext {
          const cardId = mapping.get(context.cardId);
          if (!cardId) throw new Error("Missing destination Data card");
          return { ...context, cardId };
        },
      };
    } catch (error) { await settle(entry); throw error; }
  }
  async function recover() {
    recoveryBlocked = false;
    try {
      for (const entry of journal.pending()) {
        try { await settle(entry); } catch { recoveryBlocked = true; }
      }
    } catch { recoveryBlocked = true; }
    if (recoveryBlocked) console.warn("Data handoff recovery is pending; new Data handoffs are paused.");
    return !recoveryBlocked;
  }
  return { available, preflight, copy, recover };
}
export type WorkBotData = ReturnType<typeof createWorkBotData>;
