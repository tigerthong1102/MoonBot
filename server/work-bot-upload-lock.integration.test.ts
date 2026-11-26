import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ATTACHMENTS_DIR, __resetAttachmentAccountingForTests, saveFile, saveImage, saveNamedAttachment } from "./attachments.ts";

afterEach(() => { rmSync(ATTACHMENTS_DIR, { recursive: true, force: true }); __resetAttachmentAccountingForTests(); });

it("serializes a cloud-named writer and a normal upload using the same normalized ID", async () => {
  const id = "abcdefab-1234-4234-8234-123456789abc";
  let entered!: () => void, release!: () => void, secondRead = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const bytes = Buffer.from("synthetic upload");
  async function* cloudBytes() { entered(); await wait; yield bytes; }
  async function* uploadBytes() { secondRead = true; yield bytes; }
  const cloud = saveNamedAttachment(`${id}.txt`, cloudBytes(), bytes.length);
  await started;
  const upload = saveFile(uploadBytes(), "fixture.txt", "text/plain", { uploadId: id.toUpperCase(), expectedBytes: bytes.length });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(secondRead).toBe(false);
    try { saveImage(bytes, "image/png", id.toUpperCase()); throw new Error("Expected the synchronous writer to be refused"); }
    catch (error) { expect(error).toMatchObject({ status: 409, message: expect.stringContaining("being written") }); }
  } finally { release(); }
  expect(await cloud).toEqual({ stored: true });
  expect((await upload).bytes).toBe(bytes.length);
  expect(secondRead).toBe(true);
});

it("releases the ID lock after a failed writer and permits unrelated uploads", async () => {
  const id = "abcdefab-1234-4234-8234-123456789abc", otherId = "12345678-1234-4234-8234-123456789abc";
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const bytes = Buffer.from("synthetic upload");
  async function* broken() { entered(); yield Buffer.from("partial"); await wait; throw new Error("fixture connection broke"); }
  async function* upload() { yield bytes; }
  const cloud = saveNamedAttachment(`${id}.txt`, broken());
  const failure = expect(cloud).rejects.toThrow("fixture connection broke");
  await started;
  const same = saveFile(upload(), "same.txt", "text/plain", { uploadId: id });
  try {
    const other = await saveFile(upload(), "other.txt", "text/plain", { uploadId: otherId });
    expect(other.bytes).toBe(bytes.length);
  } finally { release(); }
  await failure;
  expect((await same).bytes).toBe(bytes.length);
});

it("holds a cloud-named retry while the normalized upload ID is already being written", async () => {
  const id = "abcdefab-1234-4234-8234-123456789abc";
  let entered!: () => void, release!: () => void, cloudRead = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const bytes = Buffer.from("synthetic upload");
  async function* uploadBytes() { entered(); await wait; yield bytes; }
  async function* cloudBytes() { cloudRead = true; yield bytes; }
  const upload = saveFile(uploadBytes(), "fixture.txt", "text/plain", { uploadId: id.toUpperCase() });
  await started;
  const cloud = saveNamedAttachment(`${id}.txt`, cloudBytes(), bytes.length);
  try { await new Promise<void>(resolve => setImmediate(resolve)); expect(cloudRead).toBe(false); }
  finally { release(); }
  expect((await upload).bytes).toBe(bytes.length);
  expect((await cloud).stored).toBe(false);
  expect(cloudRead).toBe(true);
});

it("binds a guarded upload to its owner under the same ID lock and permits a matching retry", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const { basename } = await import("node:path");
  const { reserveWorkBotUpload, issueWorkBotUploadReceipt, workBotUploadIdIsFresh, WORK_BOT_UPLOAD_RECEIPTS_SCHEMA } = await import("./work-bot-upload-receipts.ts");
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  const id = "abcdefab-1234-4234-8234-123456789abc", token = Buffer.alloc(32, 20).toString("base64url"), bytes = Buffer.from("synthetic upload");
  const guard = (principal: string) => ({
    reserve: (normalized: string) => reserveWorkBotUpload(db, { principal, uploadId: normalized }, candidate => workBotUploadIdIsFresh(ATTACHMENTS_DIR, candidate)),
    finalize: async (saved: { path: string; bytes: number }) => issueWorkBotUploadReceipt(db, { principal, token, storedName: basename(saved.path), digest: createHash("sha256").update(readFileSync(saved.path)).digest("hex"), bytes: saved.bytes }),
  });
  async function* data() { yield bytes; }
  try {
    const first = await saveFile(data(), "fixture.txt", "text/plain", { uploadId: id, guard: guard("owner") });
    const retry = await saveFile(data(), "fixture.txt", "text/plain", { uploadId: id.toUpperCase(), guard: guard("owner") });
    expect(retry.path).toBe(first.path);
    await expect(saveFile(data(), "fixture.txt", "text/plain", { uploadId: id, guard: guard("other") })).rejects.toThrow("unavailable");
    expect(readFileSync(first.path)).toEqual(bytes);
  } finally { db.close(); }
});

it("leaves an uncertain file intact and refuses blind retry when finalization fails", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { reserveWorkBotUpload, workBotUploadIdIsFresh, WORK_BOT_UPLOAD_RECEIPTS_SCHEMA } = await import("./work-bot-upload-receipts.ts");
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  const id = "abcdefab-1234-4234-8234-123456789abc", bytes = Buffer.from("synthetic retained");
  const guard = { reserve: (normalized: string) => reserveWorkBotUpload(db, { principal: "owner", uploadId: normalized }, candidate => workBotUploadIdIsFresh(ATTACHMENTS_DIR, candidate)), finalize: async () => { throw new Error("synthetic finalization failure"); } };
  async function* data() { yield bytes; }
  try {
    await expect(saveFile(data(), "fixture.txt", "text/plain", { uploadId: id, guard })).rejects.toThrow("synthetic finalization failure");
    const path = join(ATTACHMENTS_DIR, `${id}.txt`);
    expect(readFileSync(path)).toEqual(bytes);
    await expect(saveFile(data(), "fixture.txt", "text/plain", { uploadId: id, guard })).rejects.toThrow("unavailable");
    expect(readFileSync(path)).toEqual(bytes);
  } finally { db.close(); }
});


it("does not clean an existing partial before an ownership guard rejects it", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { reserveWorkBotUpload, workBotUploadIdIsFresh, WORK_BOT_UPLOAD_RECEIPTS_SCHEMA } = await import("./work-bot-upload-receipts.ts");
  const db = new DatabaseSync(":memory:"); db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  const id = "abcdefab-1234-4234-8234-123456789abc";
  mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  const partial = join(ATTACHMENTS_DIR, `.openmaus-upload-${id}-12345678-1234-4234-8234-123456789abc.partial`);
  writeFileSync(partial, "synthetic partial");
  const guard = { reserve: (normalized: string) => reserveWorkBotUpload(db, { principal: "owner", uploadId: normalized }, candidate => workBotUploadIdIsFresh(ATTACHMENTS_DIR, candidate)), finalize: async () => { throw new Error("Unexpected finalize"); } };
  async function* data() { yield Buffer.from("new"); }
  try {
    await expect(saveFile(data(), "fixture.txt", "text/plain", { uploadId: id, guard })).rejects.toThrow("unavailable");
    expect(readFileSync(partial, "utf8")).toBe("synthetic partial");
  } finally { db.close(); }
});

it("recovers an incomplete owner upload only with the original receipt and the same bytes", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { randomBytes, randomUUID } = await import("node:crypto");
  const { workBotUploadGuard } = await import("./work-bot-upload-context.ts");
  const { WORK_BOT_UPLOAD_RECEIPTS_SCHEMA } = await import("./work-bot-upload-receipts.ts");
  const db = new DatabaseSync(":memory:");
  db.exec(WORK_BOT_UPLOAD_RECEIPTS_SCHEMA);
  const auth = { kind: "loopback", scopes: ["admin"], desktopOwner: true } as const;
  const id = randomUUID(), token = randomBytes(32).toString("base64url");
  const guard = workBotUploadGuard(() => db, auth, token)!;
  const retry = (value: string, attempt = guard) => saveFile((async function* () { yield Buffer.from(value); })(), "fixture.txt", "text/plain", { uploadId: id, guard: attempt });
  try {
    await expect(retry("synthetic", { ...guard, finalize: async () => { throw new Error("before finalization"); } })).rejects.toThrow("before finalization");
    await expect(retry("synthetic", workBotUploadGuard(() => db, auth, randomBytes(32).toString("base64url"))!)).rejects.toThrow("unavailable");
    await expect(retry("different")).rejects.toThrow("different file bytes");
    const recovered = await retry("synthetic");
    expect(readFileSync(recovered.path, "utf8")).toBe("synthetic");
    expect(await retry("synthetic")).toEqual(recovered);
    expect(db.prepare("SELECT * FROM work_bot_upload_reservations").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM work_bot_upload_receipts").all()).toHaveLength(1);
  } finally { db.close(); }
});
