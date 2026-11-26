import { createHash, randomBytes } from "node:crypto";
import { lstatSync, opendirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { FILE_MAX_BYTES } from "../shared/upload-limits.ts";

export const WORK_BOT_UPLOAD_RECEIPTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS work_bot_upload_owners (
    upload_id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    stored_name TEXT,
    digest TEXT,
    bytes INTEGER,
    receipt_hash TEXT,
    CHECK ((stored_name IS NULL AND digest IS NULL AND bytes IS NULL AND receipt_hash IS NULL) OR (stored_name IS NOT NULL AND digest IS NOT NULL AND bytes IS NOT NULL AND bytes > 0 AND receipt_hash IS NOT NULL))
  );
  CREATE TABLE IF NOT EXISTS work_bot_upload_reservations (
    upload_id TEXT PRIMARY KEY,
    receipt_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS work_bot_upload_receipts (
    receipt_hash TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    digest TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    thread_id TEXT,
    message_id TEXT,
    CHECK ((thread_id IS NULL) = (message_id IS NULL))
  );
  CREATE INDEX IF NOT EXISTS work_bot_upload_receipts_message ON work_bot_upload_receipts (thread_id, message_id, principal);
  CREATE TABLE IF NOT EXISTS work_bot_message_upload_sets (
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    principal TEXT NOT NULL,
    message_digest TEXT NOT NULL,
    names TEXT NOT NULL,
    PRIMARY KEY (thread_id, message_id)
  );
`;

type VerifiedUpload = { principal: string; storedName: string; digest: string; bytes: number };
type ReceiptRow = { principal: string; stored_name: string; digest: string; bytes: number; thread_id: string | null; message_id: string | null };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const identity = (value: string) => typeof value === "string" && value.length > 0 && value.length <= 500;
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, "base64url").length === 32 && Buffer.from(token, "base64url").toString("base64url") === token;
const uploadId = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const storedName = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[a-z0-9]{1,10}$/;
const validMetadata = (name: string, digest: string, bytes: number) => storedName.test(name) && /^[a-f0-9]{64}$/.test(digest) && Number.isSafeInteger(bytes) && bytes > 0 && bytes <= FILE_MAX_BYTES;
function receiptTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("SAVEPOINT work_bot_upload_receipt");
  try {
    const result = operation();
    db.exec("RELEASE work_bot_upload_receipt");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK TO work_bot_upload_receipt");
      db.exec("RELEASE work_bot_upload_receipt");
    } catch { throw new Error("Upload receipt state is uncertain"); }
    throw error;
  }
}

/** Generate the nonce the server stores with a newly created message, never one supplied by a client. */
export const newWorkBotMessageEvidenceNonce = () => randomBytes(16).toString("base64url");

/** The caller verifies the unprojected message, rejects unsupported structured context and supplies server-verified file names. */
export function workBotMessageEvidenceDigest(input: { principal: string; workspaceId: string; threadId: string; messageId: string; role: "user"; senderId: string | null; nonce: string; text: string; replyToId?: string; fileNames: readonly string[] }): string {
  if (!identity(input.principal) || !identity(input.workspaceId) || !identity(input.threadId) || !identity(input.messageId) || input.role !== "user" || (input.senderId !== null && !identity(input.senderId)) || typeof input.text !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(input.nonce)
    || Buffer.from(input.nonce, "base64url").length !== 16 || Buffer.from(input.nonce, "base64url").toString("base64url") !== input.nonce
    || (input.replyToId !== undefined && !identity(input.replyToId)) || !Array.isArray(input.fileNames) || input.fileNames.some(name => !storedName.test(name)) || new Set(input.fileNames).size !== input.fileNames.length) throw new Error("Message upload evidence is unavailable");
  return createHash("sha256").update(JSON.stringify(["work-bot-message-evidence-v1", input.principal, input.workspaceId, input.threadId, input.messageId, input.role, input.senderId, input.nonce, input.text, input.replyToId ?? null, input.fileNames])).digest("hex");
}

/** Called under the normalized upload-ID lock, before any legacy or new writer accepts bytes. */
export function workBotUploadIdIsFresh(directory: string, id: string): boolean {
  if (!uploadId.test(id)) return false;
  const normalized = id.toLowerCase();
  try {
    const root = lstatSync(directory);
    if (!root.isDirectory()) return false;
    const dir = opendirSync(directory);
    try {
      const current = lstatSync(directory);
      if (!current.isDirectory() || current.dev !== root.dev || current.ino !== root.ino) return false;
      for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
        const lower = entry.name.toLowerCase();
        if (lower.startsWith(`${normalized}.`) || lower.startsWith(`.openmaus-upload-${normalized}-`)) return false;
      }
      return true;
    } finally { dir.closeSync(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Under the upload ID's lock, authenticate and commit this reservation before making bytes visible; refuse unowned existing files. */
export function reserveWorkBotUpload(db: DatabaseSync, input: { principal: string; uploadId: string; token?: string }, fresh: (id: string) => boolean): void {
  if (!identity(input.principal) || !uploadId.test(input.uploadId) || (input.token !== undefined && !validToken(input.token))) throw new Error("Invalid upload receipt");
  const id = input.uploadId.toLowerCase();
  const tokenHash = input.token && hash(input.token);
  receiptTransaction(db, () => {
    const owner = db.prepare("SELECT principal, stored_name, receipt_hash FROM work_bot_upload_owners WHERE upload_id = ?").get(id) as { principal: string; stored_name: string | null; receipt_hash: string | null } | undefined;
    if (owner && owner.principal !== input.principal) throw new Error("Upload receipt is unavailable");
    if (owner?.stored_name) {
      if (tokenHash && tokenHash !== owner.receipt_hash) throw new Error("Upload receipt is unavailable");
      return;
    }
    const reservation = db.prepare("SELECT receipt_hash FROM work_bot_upload_reservations WHERE upload_id = ?").get(id);
    if (reservation) {
      if (!owner || tokenHash !== reservation.receipt_hash) throw new Error("Upload receipt is unavailable");
      return;
    }
    let available = false;
    try { available = fresh(id); } catch { throw new Error("Upload receipt is unavailable"); }
    if (available !== true) throw new Error("Upload receipt is unavailable");
    if (!owner) db.prepare("INSERT INTO work_bot_upload_owners (upload_id,principal) VALUES (?,?)").run(id, input.principal);
    if (tokenHash) db.prepare("INSERT INTO work_bot_upload_reservations (upload_id,receipt_hash) VALUES (?,?)").run(id, tokenHash);
  });
}

/** The caller verifies the upload under its ID lock and commits finalization and receipt issuance in one transaction. */
export function issueWorkBotUploadReceipt(db: DatabaseSync, input: VerifiedUpload & { token: string }): void {
  if (!identity(input.principal) || !validToken(input.token) || !validMetadata(input.storedName, input.digest, input.bytes)) throw new Error("Invalid upload receipt");
  receiptTransaction(db, () => {
    const receiptHash = hash(input.token);
    const id = input.storedName.slice(0, 36).toLowerCase();
    const reservation = db.prepare("SELECT receipt_hash FROM work_bot_upload_reservations WHERE upload_id = ?").get(id);
    if (reservation && reservation.receipt_hash !== receiptHash) throw new Error("Upload receipt is unavailable");
    const owner = db.prepare("UPDATE work_bot_upload_owners SET stored_name = ?, digest = ?, bytes = ?, receipt_hash = ? WHERE upload_id = ? AND principal = ? AND (stored_name IS NULL OR (stored_name = ? AND digest = ? AND bytes = ? AND receipt_hash = ?)) RETURNING upload_id").get(input.storedName, input.digest, input.bytes, receiptHash, id, input.principal, input.storedName, input.digest, input.bytes, receiptHash);
    if (!owner) throw new Error("Upload receipt is unavailable");
    const receipt = db.prepare("INSERT INTO work_bot_upload_receipts (receipt_hash, principal, stored_name, digest, bytes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(receipt_hash) DO UPDATE SET receipt_hash = excluded.receipt_hash WHERE principal = excluded.principal AND stored_name = excluded.stored_name AND digest = excluded.digest AND bytes = excluded.bytes RETURNING receipt_hash").get(receiptHash, input.principal, input.storedName, input.digest, input.bytes);
    if (!receipt) throw new Error("Upload receipt is unavailable");
    db.prepare("DELETE FROM work_bot_upload_reservations WHERE upload_id = ?").run(id);
  });
}

/** Binds an authenticated upload to exactly one source message; the caller commits this with that message. */
export function claimWorkBotUploadReceipt(db: DatabaseSync, input: { token: string; principal: string; threadId: string; messageId: string }): VerifiedUpload {
  if (!validToken(input.token) || !identity(input.principal) || !identity(input.threadId) || !identity(input.messageId)) throw new Error("Upload receipt is unavailable");
  const key = hash(input.token);
  const row = db.prepare("SELECT principal, stored_name, digest, bytes, thread_id, message_id FROM work_bot_upload_receipts WHERE receipt_hash = ?").get(key) as ReceiptRow | undefined;
  if (!row || row.principal !== input.principal || !validMetadata(row.stored_name, row.digest, row.bytes) || (row.thread_id !== null && (row.thread_id !== input.threadId || row.message_id !== input.messageId))) throw new Error("Upload receipt is unavailable");
  if (row.thread_id === null) {
    const changed = db.prepare("UPDATE work_bot_upload_receipts SET thread_id = ?, message_id = ? WHERE receipt_hash = ? AND principal = ? AND thread_id IS NULL AND message_id IS NULL").run(input.threadId, input.messageId, key, input.principal);
    if (changed.changes !== 1) throw new Error("Upload receipt is unavailable");
  }
  return { principal: row.principal, storedName: row.stored_name, digest: row.digest, bytes: row.bytes };
}

type MessageSet = { principal: string; threadId: string; messageId: string; messageDigest: string; expectedNames: readonly string[] };

function verifiedMessageUploads(db: DatabaseSync, input: MessageSet): VerifiedUpload[] {
  if (!identity(input.principal) || !identity(input.threadId) || !identity(input.messageId) || !/^[a-f0-9]{64}$/.test(input.messageDigest) || !Array.isArray(input.expectedNames) || new Set(input.expectedNames).size !== input.expectedNames.length) throw new Error("Message upload evidence is unavailable");
  const rows = db.prepare("SELECT principal, stored_name, digest, bytes FROM work_bot_upload_receipts WHERE thread_id = ? AND message_id = ? AND principal = ? ORDER BY stored_name").all(input.threadId, input.messageId, input.principal) as Array<Pick<ReceiptRow, "principal" | "stored_name" | "digest" | "bytes">>;
  const names = [...input.expectedNames].sort();
  if (names.length !== rows.length || names.some((name, index) => name !== rows[index]!.stored_name) || rows.some(row => !validMetadata(row.stored_name, row.digest, row.bytes))) throw new Error("Message upload evidence is unavailable");
  return rows.map(row => ({ principal: row.principal, storedName: row.stored_name, digest: row.digest, bytes: row.bytes }));
}

/** The caller records the complete, verified set in the same transaction as the newly created message. */
export function markWorkBotMessageUploads(db: DatabaseSync, input: MessageSet): void {
  verifiedMessageUploads(db, input);
  const names = JSON.stringify([...input.expectedNames].sort());
  const result = db.prepare("INSERT INTO work_bot_message_upload_sets (thread_id, message_id, principal, message_digest, names) VALUES (?, ?, ?, ?, ?) ON CONFLICT(thread_id, message_id) DO UPDATE SET names = excluded.names WHERE principal = excluded.principal AND message_digest = excluded.message_digest AND names = excluded.names RETURNING message_id").get(input.threadId, input.messageId, input.principal, input.messageDigest, names);
  if (!result) throw new Error("Message upload evidence is unavailable");
}

/** The caller authorizes the source and reads its complete, server-recorded upload set in a consistent snapshot. */
export function workBotMessageUploads(db: DatabaseSync, input: { principal: string; threadId: string; messageId: string; messageDigest: string }): VerifiedUpload[] {
  if (!identity(input.principal) || !identity(input.threadId) || !identity(input.messageId) || !/^[a-f0-9]{64}$/.test(input.messageDigest)) throw new Error("Message upload evidence is unavailable");
  const rows = db.prepare("SELECT s.names, r.principal, r.stored_name, r.digest, r.bytes FROM work_bot_message_upload_sets s LEFT JOIN work_bot_upload_receipts r ON r.thread_id = s.thread_id AND r.message_id = s.message_id AND r.principal = s.principal WHERE s.thread_id = ? AND s.message_id = ? AND s.principal = ? AND s.message_digest = ? ORDER BY r.stored_name").all(input.threadId, input.messageId, input.principal, input.messageDigest) as Array<{ names: string; principal: string | null; stored_name: string | null; digest: string | null; bytes: number | null }>;
  let names: unknown;
  try { names = rows[0] && JSON.parse(rows[0].names); } catch { throw new Error("Message upload evidence is unavailable"); }
  if (!Array.isArray(names) || names.some(name => typeof name !== "string")) throw new Error("Message upload evidence is unavailable");
  const present = rows.filter(row => row.stored_name !== null);
  const sorted = [...names].sort();
  if (new Set(sorted).size !== sorted.length || present.length !== sorted.length || sorted.some((name, index) => name !== present[index]!.stored_name) || present.some(row => row.principal !== input.principal || row.stored_name === null || row.digest === null || row.bytes === null || !validMetadata(row.stored_name, row.digest, row.bytes))) throw new Error("Message upload evidence is unavailable");
  return present.map(row => ({ principal: row.principal!, storedName: row.stored_name!, digest: row.digest!, bytes: row.bytes! }));
}
