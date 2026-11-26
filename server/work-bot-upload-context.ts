import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FILE_MAX_BYTES } from "../shared/upload-limits.ts";
import { ATTACHMENTS_DIR, DATA_DIR } from "./config.ts";
import type { Message } from "./store.ts";
import type { FollowupPayload } from "./message-db.ts";
import type { RequestAuth } from "./request-auth.ts";
import { attachmentTagCandidates } from "./attachment-tags.ts";
import { claimWorkBotUploadReceipt, issueWorkBotUploadReceipt, markWorkBotMessageUploads, newWorkBotMessageEvidenceNonce, reserveWorkBotUpload, workBotMessageEvidenceDigest, workBotMessageUploads, workBotUploadIdIsFresh } from "./work-bot-upload-receipts.ts";

type Binding = { threadId: string; sendId: string; text: string; tokens: string[] };
const sending = new AsyncLocalStorage<Binding>();
const principal = "personal-desktop";
const fileName = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/;
const receipt = /^[A-Za-z0-9_-]{43}$/;
const desktop = (auth: RequestAuth) => auth.kind === "loopback" && auth.desktopOwner && !process.env.OMB_CLOUD_ROLE;

function stamp(path: string) {
  const st = lstatSync(path, { bigint: true });
  if (!st.isFile() || st.size <= 0n || st.size > BigInt(FILE_MAX_BYTES) || realpathSync(path) !== join(realpathSync(ATTACHMENTS_DIR), basename(path))) throw new Error("Attachment changed");
  return [st.dev, st.ino, st.size, st.ctimeNs, st.mtimeNs].join(":");
}

async function contentHash(path: string) {
  const before = stamp(path);
  const file = await open(path, "r");
  try {
    const st = await file.stat({ bigint: true });
    if ([st.dev, st.ino, st.size, st.ctimeNs, st.mtimeNs].join(":") !== before) throw new Error("Attachment changed");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    if (stamp(path) !== before) throw new Error("Attachment changed");
    return { digest: hash.digest("hex"), stamp: before };
  } finally { await file.close(); }
}

export function workBotUploadGuard(db: () => DatabaseSync, auth: RequestAuth, token: unknown) {
  if (!token || !desktop(auth)) return undefined;
  if (typeof token !== "string" || !receipt.test(token)) throw Object.assign(new Error("Invalid upload receipt"), { status: 400 });
  return {
    reserve: (uploadId: string) => reserveWorkBotUpload(db(), { principal, uploadId, token }, id => workBotUploadIdIsFresh(ATTACHMENTS_DIR, id)),
    finalize: async (file: { path: string; bytes: number }) => {
      const { digest } = await contentHash(file.path);
      issueWorkBotUploadReceipt(db(), { principal, token, digest, storedName: basename(file.path), bytes: file.bytes });
    },
  };
}

export function withWorkBotUploadSend<T>(auth: RequestAuth, threadId: string, sendId: string | undefined, text: string, tokens: unknown, send: () => T): T {
  if (!desktop(auth) || tokens === undefined) return send();
  if (!sendId || !Array.isArray(tokens) || !tokens.length || tokens.length > 100 || tokens.some(value => typeof value !== "string" || !receipt.test(value))) throw Object.assign(new Error("Invalid attachment selection"), { status: 400 });
  return sending.run({ threadId, sendId, text, tokens }, send);
}

type Source = Pick<Message, "id" | "role" | "kind" | "text" | "replyToId" | "sender" | "sendId" | "workBotUploadNonce">;

function sourceFiles(message: Source) {
  if (message.role !== "user" || message.kind !== "text" || !message.text) return [];
  const tags = attachmentTagCandidates(message.text);
  if (tags.some(tag => !fileName.test(basename(tag.path)) || join(ATTACHMENTS_DIR, basename(tag.path)) !== tag.path)) return [];
  return tags;
}

function evidence(threadId: string, message: Source, nonce: string, names: string[]) {
  const messageId = message.id;
  const messageDigest = workBotMessageEvidenceDigest({ principal, workspaceId: DATA_DIR, threadId, messageId, role: "user", senderId: message.sender?.id ?? null, nonce, text: message.text!, replyToId: message.replyToId, fileNames: names });
  return { principal, threadId, messageId, messageDigest, expectedNames: names };
}

export function bindWorkBotMessageUploads(db: DatabaseSync, threadId: string, message: Source) {
  const context = sending.getStore();
  if (!context || context.threadId !== threadId || context.sendId !== message.sendId || context.text !== message.text || message.role !== "user" || message.kind !== "text") return;
  const names = [...new Set(sourceFiles(message).map(tag => basename(tag.path)))];
  if (!names.length || names.length !== context.tokens.length) return;
  const nonce = newWorkBotMessageEvidenceNonce();
  for (const token of context.tokens) claimWorkBotUploadReceipt(db, { principal, token, threadId, messageId: message.id });
  markWorkBotMessageUploads(db, evidence(threadId, message, nonce, names));
  message.workBotUploadNonce = nonce;
}

export function queuedUploadMessage(queueId: string, payload: FollowupPayload): Message {
  return { id: "queue:" + queueId, role: "user", kind: "text", at: payload.queuedAt ?? 0, text: payload.text,
    sendId: payload.sendId, sender: payload.sender, replyToId: payload.replyToId, dataContext: payload.dataContext,
    workBotUploadNonce: payload.workBotUploadNonce };
}

export function moveQueuedUploads(db: DatabaseSync, sourceThread: string, queued: Message, targetThread: string, message: Message): void {
  if (!queued.workBotUploadNonce) return;
  if (queued.text !== message.text || queued.sendId !== message.sendId || queued.replyToId !== message.replyToId || queued.sender?.id !== message.sender?.id) throw new Error("The queued attachment selection changed");
  const names = [...new Set(sourceFiles(queued).map(tag => basename(tag.path)))];
  if (!names.length) throw new Error("Missing queued attachment evidence");
  const from = evidence(sourceThread, queued, queued.workBotUploadNonce, names);
  workBotMessageUploads(db, from);
  const moved = db.prepare("UPDATE work_bot_upload_receipts SET thread_id = ?, message_id = ? WHERE thread_id = ? AND message_id = ? AND principal = ?").run(targetThread, message.id, sourceThread, queued.id, principal);
  if (moved.changes !== names.length) throw new Error("Incomplete queued attachment evidence");
  const nonce = newWorkBotMessageEvidenceNonce();
  markWorkBotMessageUploads(db, evidence(targetThread, message, nonce, names));
  db.prepare("DELETE FROM work_bot_message_upload_sets WHERE thread_id = ? AND message_id = ? AND principal = ?").run(sourceThread, queued.id, principal);
  message.workBotUploadNonce = nonce;
}

/** Only proven transport tags are excluded from the text-only path scan. The original text is sent intact. */
export function portableUpload(db: DatabaseSync, threadId: string, message: Source) {
  if (!message.workBotUploadNonce || process.env.OMB_CLOUD_ROLE) return null;
  try {
    const tags = sourceFiles(message);
    if (!tags.length) return null;
    const names = [...new Set(tags.map(tag => basename(tag.path)))];
    const records = workBotMessageUploads(db, evidence(threadId, message, message.workBotUploadNonce, names));
    const files = records.map(record => {
      const path = join(ATTACHMENTS_DIR, record.storedName);
      return { path, digest: record.digest, stamp: stamp(path) };
    });
    let prose = message.text!;
    for (const tag of tags.reverse()) prose = prose.slice(0, tag.start) + " " + prose.slice(tag.end);
    return { prose, files };
  } catch { return null; }
}

export async function verifyPortableFiles(files: Array<{ path: string; digest: string; stamp: string }>) {
  const unique = new Map<string, (typeof files)[number]>();
  for (const file of files) {
    const seen = unique.get(file.path);
    if (seen && (seen.digest !== file.digest || seen.stamp !== file.stamp)) throw new Error("Attachment changed during handoff");
    unique.set(file.path, file);
  }
  for (const file of unique.values()) {
    const current = await contentHash(file.path);
    if (current.digest !== file.digest || current.stamp !== file.stamp) throw new Error("Attachment changed during handoff");
  }
  return () => {
    for (const file of unique.values()) if (stamp(file.path) !== file.stamp) throw new Error("Attachment changed during handoff");
  };
}
