import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { claimWorkBotUploadReceipt, issueWorkBotUploadReceipt, reserveWorkBotUpload, markWorkBotMessageUploads, newWorkBotMessageEvidenceNonce, workBotMessageEvidenceDigest, workBotMessageUploads, workBotUploadIdIsFresh, WORK_BOT_UPLOAD_RECEIPTS_SCHEMA } from "./work-bot-upload-receipts.ts";

it("binds a verified upload to one principal and source message without storing the bearer token", () => {
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  try {
    const token = Buffer.alloc(32, 1).toString("base64url");
    const input = { principal: "fixture-owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "a".repeat(64), bytes: 42 };
    expect(() => issueWorkBotUploadReceipt(db, { ...input, token })).toThrow("unavailable");
    expect(() => reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => false)).toThrow("unavailable");
    expect(() => reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => { throw new Error("synthetic private path"); })).toThrow("Upload receipt is unavailable");
    reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => true);
    expect(() => reserveWorkBotUpload(db, { principal: "other", uploadId: input.storedName.slice(0, 36).toUpperCase() }, () => true)).toThrow("unavailable");
    expect(() => reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36).toUpperCase() }, () => false)).toThrow("unavailable");
    expect(() => issueWorkBotUploadReceipt(db, { ...input, storedName: input.storedName.toUpperCase(), token })).toThrow("Invalid");
    issueWorkBotUploadReceipt(db, { ...input, token });
    expect(() => reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36).toUpperCase() }, () => false)).not.toThrow();
    expect(() => issueWorkBotUploadReceipt(db, { ...input, token, principal: "other" })).toThrow("unavailable");
    expect(() => issueWorkBotUploadReceipt(db, { ...input, token, digest: "b".repeat(64) })).toThrow("unavailable");
    expect(() => issueWorkBotUploadReceipt(db, { ...input, token: Buffer.alloc(32, 2).toString("base64url") })).toThrow("unavailable");
    expect(() => issueWorkBotUploadReceipt(db, { ...input, token })).not.toThrow();
    expect(JSON.stringify(db.prepare("SELECT * FROM work_bot_upload_receipts").all())).not.toContain(token);
    expect(() => claimWorkBotUploadReceipt(db, { token, principal: "other", threadId: "thread", messageId: "message" })).toThrow("unavailable");
    const claim = { token, principal: input.principal, threadId: "thread", messageId: "message" };
    expect(claimWorkBotUploadReceipt(db, claim)).toEqual(input);
    expect(claimWorkBotUploadReceipt(db, claim)).toEqual(input);
    const lookup = { principal: claim.principal, threadId: claim.threadId, messageId: claim.messageId, messageDigest: "f".repeat(64) };
    expect(() => workBotMessageUploads(db, lookup)).toThrow("unavailable");
    expect(() => markWorkBotMessageUploads(db, { ...lookup, expectedNames: [input.storedName, "missing.pdf"] })).toThrow("unavailable");
    markWorkBotMessageUploads(db, { ...lookup, expectedNames: [input.storedName] });
    expect(workBotMessageUploads(db, lookup)).toEqual([input]);
    expect(() => workBotMessageUploads(db, { ...lookup, principal: "other" })).toThrow("unavailable");
    expect(() => workBotMessageUploads(db, { ...lookup, messageId: "other-message" })).toThrow("unavailable");
    expect(() => workBotMessageUploads(db, { ...lookup, messageDigest: "0".repeat(64) })).toThrow("unavailable");
    expect(() => markWorkBotMessageUploads(db, { ...lookup, expectedNames: [] })).toThrow("unavailable");
    expect(() => claimWorkBotUploadReceipt(db, { ...claim, messageId: "other-message" })).toThrow("unavailable");
    expect(() => claimWorkBotUploadReceipt(db, { ...claim, threadId: "other-thread" })).toThrow("unavailable");
    db.exec("DELETE FROM work_bot_upload_receipts");
    expect(() => workBotMessageUploads(db, lookup)).toThrow("unavailable");
  } finally { db.close(); }
});

it("rolls back every file binding when the enclosing message transaction fails", () => {
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  try {
    const input = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "b".repeat(64), bytes: 8 };
    reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => true);
    const token = Buffer.alloc(32, 3).toString("base64url");
    issueWorkBotUploadReceipt(db, { ...input, token });
    db.exec("BEGIN IMMEDIATE");
    claimWorkBotUploadReceipt(db, { token, principal: "owner", threadId: "thread", messageId: "failed-message" });
    expect(() => claimWorkBotUploadReceipt(db, { token: "bad", principal: "owner", threadId: "thread", messageId: "failed-message" })).toThrow();
    db.exec("ROLLBACK");
    expect(claimWorkBotUploadReceipt(db, { token, principal: "owner", threadId: "thread", messageId: "next-message" })).toEqual(input);
  } finally { db.close(); }
});

it("rolls back finalization if a receipt token conflicts with another upload", () => {
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  try {
    const first = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "a".repeat(64), bytes: 9 };
    const second = { ...first, storedName: "22345678-1234-4234-8234-123456789abc.pdf" };
    const firstToken = Buffer.alloc(32, 4).toString("base64url"), secondToken = Buffer.alloc(32, 5).toString("base64url");
    reserveWorkBotUpload(db, { principal: first.principal, uploadId: first.storedName.slice(0, 36) }, () => true);
    reserveWorkBotUpload(db, { principal: second.principal, uploadId: second.storedName.slice(0, 36) }, () => true);
    issueWorkBotUploadReceipt(db, { ...first, token: firstToken });
    expect(() => issueWorkBotUploadReceipt(db, { ...second, token: firstToken })).toThrow("unavailable");
    expect(() => issueWorkBotUploadReceipt(db, { ...second, token: secondToken })).not.toThrow();
  } finally { db.close(); }
});

it("commits or rolls back the message and its claimed upload together", () => {
  const db = new DatabaseSync(":memory:"); db.exec(`${WORK_BOT_UPLOAD_RECEIPTS_SCHEMA} CREATE TABLE messages (thread_id TEXT, id TEXT PRIMARY KEY);`);
  try {
    const input = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "c".repeat(64), bytes: 8 }, token = Buffer.alloc(32, 6).toString("base64url");
    reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => true);
    issueWorkBotUploadReceipt(db, { ...input, token });
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO messages (thread_id, id) VALUES (?, ?)").run("thread", "failed");
    claimWorkBotUploadReceipt(db, { token, principal: "owner", threadId: "thread", messageId: "failed" });
    db.exec("ROLLBACK");
    expect(db.prepare("SELECT id FROM messages").all()).toHaveLength(0);
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO messages (thread_id, id) VALUES (?, ?)").run("thread", "committed");
    claimWorkBotUploadReceipt(db, { token, principal: "owner", threadId: "thread", messageId: "committed" });
    db.exec("COMMIT");
    expect(db.prepare("SELECT id FROM messages").all()).toMatchObject([{ id: "committed" }]);
    expect(() => claimWorkBotUploadReceipt(db, { token, principal: "owner", threadId: "thread", messageId: "other" })).toThrow("unavailable");
  } finally { db.close(); }
});


it("refuses existing legacy or partial files across extension and case variants", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-upload-fresh-"));
  const id = "abcdefab-1234-4234-8234-123456789abc";
  try {
    expect(workBotUploadIdIsFresh(join(dir, "missing"), id)).toBe(false);
    expect(workBotUploadIdIsFresh(dir, id)).toBe(true);
    const legacy = join(dir, `${id.toUpperCase()}.PDF`);
    writeFileSync(legacy, "synthetic");
    expect(workBotUploadIdIsFresh(dir, id)).toBe(false);
    rmSync(legacy);
    const partial = join(dir, `.openmaus-upload-${id}-abc.partial`);
    writeFileSync(partial, "synthetic");
    expect(workBotUploadIdIsFresh(dir, id.toUpperCase())).toBe(false);
    rmSync(partial);
    expect(workBotUploadIdIsFresh(dir, id)).toBe(true);
    if (process.platform !== "win32") {
      const link = join(dir, `${id}.txt`);
      symlinkSync(join(dir, "missing-target"), link);
      expect(workBotUploadIdIsFresh(dir, id)).toBe(false);
      const alias = join(dir, "alias");
      symlinkSync(dir, alias);
      expect(workBotUploadIdIsFresh(alias, id)).toBe(false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("keeps message-bound evidence across reopening without persisting the token", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-upload-ledger-")), file = join(dir, "fixture.sqlite");
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file); db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; ${WORK_BOT_UPLOAD_RECEIPTS_SCHEMA}`);
    const input = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "d".repeat(64), bytes: 12 }, token = Buffer.alloc(32, 7).toString("base64url");
    reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => true);
    db.exec("BEGIN IMMEDIATE"); issueWorkBotUploadReceipt(db, { ...input, token }); db.exec("COMMIT");
    db.exec("BEGIN IMMEDIATE"); claimWorkBotUploadReceipt(db, { token, principal: input.principal, threadId: "thread", messageId: "message" }); markWorkBotMessageUploads(db, { principal: input.principal, threadId: "thread", messageId: "message", messageDigest: "f".repeat(64), expectedNames: [input.storedName] }); db.exec("COMMIT");
    db.close(); db = new DatabaseSync(file);
    expect(workBotMessageUploads(db, { principal: input.principal, threadId: "thread", messageId: "message", messageDigest: "f".repeat(64) })).toEqual([input]);
    expect(JSON.stringify(db.prepare("SELECT * FROM work_bot_upload_receipts").all())).not.toContain(token);
    expect(() => claimWorkBotUploadReceipt(db!, { token, principal: input.principal, threadId: "thread", messageId: "other" })).toThrow("unavailable");
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});


it("distinguishes a verified empty upload set from legacy messages", () => {
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  try {
    const identity = { principal: "owner", threadId: "thread", messageId: "message", messageDigest: "f".repeat(64) };
    expect(() => workBotMessageUploads(db, identity)).toThrow("unavailable");
    markWorkBotMessageUploads(db, { ...identity, expectedNames: [] });
    expect(workBotMessageUploads(db, identity)).toEqual([]);
    expect(() => workBotMessageUploads(db, { ...identity, messageId: "legacy" })).toThrow("unavailable");
  } finally { db.close(); }
});

it("refuses damaged upload metadata even when the message marker matches", () => {
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  try {
    const input = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "e".repeat(64), bytes: 12 }, token = Buffer.alloc(32, 8).toString("base64url");
    const identity = { principal: input.principal, threadId: "thread", messageId: "message", messageDigest: "f".repeat(64) };
    reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => true);
    issueWorkBotUploadReceipt(db, { ...input, token });
    claimWorkBotUploadReceipt(db, { ...identity, token });
    markWorkBotMessageUploads(db, { ...identity, expectedNames: [input.storedName] });
    for (const [name, digest, bytes] of [["../outside.pdf", input.digest, 12], [input.storedName, "bad", 12], [input.storedName, input.digest, -1], [input.storedName, input.digest, "bad"]] as const) {
      db.prepare("UPDATE work_bot_upload_receipts SET stored_name = ?, digest = ?, bytes = ?").run(name, digest, bytes);
      db.prepare("UPDATE work_bot_message_upload_sets SET names = ?").run(JSON.stringify([name]));
      expect(() => workBotMessageUploads(db, identity)).toThrow("unavailable");
      expect(() => claimWorkBotUploadReceipt(db, { ...identity, token })).toThrow("unavailable");
    }
  } finally { db.close(); }
});


it("changes the server evidence digest when the source text, owner, files or incarnation changes", () => {
  const base = { principal: "owner", workspaceId: "workspace", threadId: "thread", messageId: "message", role: "user" as const, senderId: "sender", nonce: newWorkBotMessageEvidenceNonce(), text: "Theo dõi kho", fileNames: ["12345678-1234-4234-8234-123456789abc.pdf"] };
  const digest = workBotMessageEvidenceDigest(base);
  expect(workBotMessageEvidenceDigest({ ...base })).toBe(digest);
  for (const changed of [{ text: "Theo dõi kho mới" }, { principal: "other" }, { workspaceId: "other-workspace" }, { senderId: "other-sender" }, { nonce: newWorkBotMessageEvidenceNonce() }, { fileNames: [] }, { replyToId: "reply" }]) expect(workBotMessageEvidenceDigest({ ...base, ...changed })).not.toBe(digest);
  expect(() => workBotMessageEvidenceDigest({ ...base, nonce: "invalid" })).toThrow("unavailable");
});

it("keeps receipt issuance inside the caller's outer transaction", () => {
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  try {
    const input = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "a".repeat(64), bytes: 4 };
    const token = Buffer.alloc(32, 11).toString("base64url"), next = Buffer.alloc(32, 12).toString("base64url");
    reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => true);
    db.exec("BEGIN IMMEDIATE"); issueWorkBotUploadReceipt(db, { ...input, token }); db.exec("ROLLBACK");
    expect(() => claimWorkBotUploadReceipt(db, { token, principal: input.principal, threadId: "thread", messageId: "message" })).toThrow("unavailable");
    expect(() => issueWorkBotUploadReceipt(db, { ...input, token: next })).not.toThrow();
  } finally { db.close(); }
});

it("isolates a receipt conflict from an outer transaction", () => {
  const db = new DatabaseSync(":memory:"); db.exec(`${WORK_BOT_UPLOAD_RECEIPTS_SCHEMA} CREATE TABLE fixture_rows (id TEXT);`);
  try {
    const first = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "a".repeat(64), bytes: 4 };
    const second = { ...first, storedName: "22345678-1234-4234-8234-123456789abc.pdf" }, token = Buffer.alloc(32, 13).toString("base64url");
    reserveWorkBotUpload(db, { principal: first.principal, uploadId: first.storedName.slice(0, 36) }, () => true);
    reserveWorkBotUpload(db, { principal: second.principal, uploadId: second.storedName.slice(0, 36) }, () => true);
    issueWorkBotUploadReceipt(db, { ...first, token });
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO fixture_rows VALUES (?)").run("before");
    expect(() => issueWorkBotUploadReceipt(db, { ...second, token })).toThrow("unavailable");
    db.prepare("INSERT INTO fixture_rows VALUES (?)").run("after");
    db.exec("COMMIT");
    expect(db.prepare("SELECT id FROM fixture_rows ORDER BY id").all()).toMatchObject([{ id: "after" }, { id: "before" }]);
    expect(() => issueWorkBotUploadReceipt(db, { ...second, token: Buffer.alloc(32, 14).toString("base64url") })).not.toThrow();
  } finally { db.close(); }
});

it("reports uncertain state if rollback itself fails", () => {
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  try {
    const input = { principal: "owner", storedName: "12345678-1234-4234-8234-123456789abc.pdf", digest: "a".repeat(64), bytes: 4 };
    const token = Buffer.alloc(32, 15).toString("base64url");
    reserveWorkBotUpload(db, { principal: input.principal, uploadId: input.storedName.slice(0, 36) }, () => true);
    issueWorkBotUploadReceipt(db, { ...input, token });
    const fault = new Proxy(db, { get(target, key) {
      if (key === "exec") return (sql: string) => { if (sql.startsWith("ROLLBACK TO")) throw new Error("synthetic disk error"); return target.exec(sql); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    expect(() => issueWorkBotUploadReceipt(fault, { ...input, token: Buffer.alloc(32, 16).toString("base64url") })).toThrow("state is uncertain");
    db.exec("ROLLBACK");
  } finally { db.close(); }
});
