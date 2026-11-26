import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { promptWithDataContext } from "../shared/data-context.ts";
import { saveFile } from "./attachments.ts";
import { appendMessage, chatFollowups, clearThreadMessages, closeMessageDb, portableWorkBotUpload, settleChatFollowups, transferQueuedWorkBotMessages, uploadGuardForWorkBot } from "./message-db.ts";
import { queueSteeredMessage, restoreSteeredMessages, safeWorkBotFollowups, workBotQueuedFollowups, workBotQueuedMessage } from "./steer-queue.ts";
import type { Message } from "./store.ts";
import { verifyPortableFiles, withWorkBotUploadSend } from "./work-bot-upload-context.ts";

const owner = { kind: "loopback", scopes: ["admin"], desktopOwner: true } as const;
const cleanup: string[] = [];
afterEach(() => {
  for (const file of cleanup.splice(0)) rmSync(file, { force: true });
});

async function enqueue(data?: Message["dataContext"]) {
  const threadId = randomUUID(), botId = randomUUID(), sendId = randomUUID(), token = randomBytes(32).toString("base64url");
  const bytes = Buffer.from("synthetic inventory = 42");
  const file = await saveFile((async function* () { yield bytes; })(), "inventory.txt", "text/plain", { uploadId: randomUUID(), guard: uploadGuardForWorkBot(owner, token) });
  cleanup.push(file.path);
  const text = 'Also track this file\n\n<attached-file path="' + file.path + '" name="inventory.txt"/>';
  const source: Message = { id: randomUUID(), kind: "text", role: "user", text: "Monitor the weekly stock count", at: 1, workBotRouting: { state: "waiting_choice", triggerKind: "user" } };
  const trigger = { kind: "user" } as const;
  const queued = withWorkBotUploadSend(owner, threadId, sendId, text, [token], () => queueSteeredMessage(botId, threadId, text, { sendId, trigger, dataContext: data, prompt: promptWithDataContext(text, data), workBotOfferSource: source.id, workBotOfferOwner: "" }));
  expect(JSON.stringify(chatFollowups("bot"))).not.toContain(token);
  closeMessageDb();
  restoreSteeredMessages();
  const item = workBotQueuedFollowups(botId, threadId, source.id)[0]!;
  const message = workBotQueuedMessage(item);
  expect(item.messageId).toBe(queued.id);
  return { source, threadId, botId, sendId, token, bytes, text, queued, item, message, file, trigger };
}

it("retains a proven upload across queue restart and binds it to the source transcript on a normal drain", async () => {
  const { threadId, item, message, source, botId, queued, sendId, text, file, bytes } = await enqueue();
  expect(safeWorkBotFollowups(botId, threadId, source)).toBe(true);
  const refs = portableWorkBotUpload(threadId, message)!;
  expect(refs.prose).not.toContain(file.path);
  const check = await verifyPortableFiles(refs.files);
  check();
  expect(portableWorkBotUpload(randomUUID(), message)).toBeNull();
  settleChatFollowups([queued.id], "dispatching");
  const actual: Message = { id: randomUUID(), kind: "text", role: "user", at: item.queuedAt, queueId: queued.id, sendId, text };
  appendMessage(threadId, actual);
  expect(portableWorkBotUpload(threadId, actual)?.files[0]?.path).toBe(file.path);
  expect(portableWorkBotUpload(threadId, message)).toBeNull();
  writeFileSync(file.path, Buffer.alloc(bytes.byteLength, 1));
  expect(() => check()).toThrow();
  await expect(verifyPortableFiles(portableWorkBotUpload(threadId, actual)!.files)).rejects.toThrow();
  settleChatFollowups([queued.id], null);
  clearThreadMessages(threadId, () => {});
  expect(portableWorkBotUpload(threadId, actual)).toBeNull();
  expect(readFileSync(file.path)).toEqual(Buffer.alloc(bytes.byteLength, 1));
});

it("atomically transfers a queued upload and snapped Data mapping; rejecting the wrong destination keeps the queue recoverable", async () => {
  const dataContext = { cardId: "c_1", draftSql: "select 41" };
  const { threadId, botId, source, queued, sendId, text, file, message, item, trigger } = await enqueue(dataContext);
  expect(safeWorkBotFollowups(botId, threadId, source)).toBe(false);
  expect(safeWorkBotFollowups(botId, threadId, source, row => row.dataContext?.cardId === "c_1")).toBe(true);
  const targetThread = randomUUID();
  const anchor = { messageId: source.id, threadId, botId };
  const root: Message = { id: randomUUID(), kind: "text", role: "user", text: source.text, at: 1, workBotRecoveryPending: true, workBotHandoffSource: anchor };
  const target: Message = { id: randomUUID(), kind: "text", role: "user", text, queueId: queued.id, sendId, at: item.queuedAt, parentId: root.id, workBotRecoveryPending: true, workBotHandoffSource: anchor, dataContext };
  const claim = { botId, sourceThreadId: threadId, sourceMessageId: source.id, queueIds: [queued.id], trigger, offerOwner: "", dataCardIds: { c_1: "c_2" } };
  const transfer = () => transferQueuedWorkBotMessages(targetThread, [root, target], claim);
  expect(transfer).toThrow("Data context");
  expect(portableWorkBotUpload(threadId, message)?.files[0]?.path).toBe(file.path);
  target.dataContext = { cardId: "c_2", draftSql: dataContext.draftSql };
  transfer();
  expect(transfer).toThrow();
  expect(portableWorkBotUpload(threadId, message)).toBeNull();
  expect(portableWorkBotUpload(targetThread, target)?.files[0]?.path).toBe(file.path);
  expect(readFileSync(file.path, "utf8")).toBe("synthetic inventory = 42");
  expect(chatFollowups("bot").find(row => row.id === queued.id)?.status).toBe("transferred");
});

it("revokes queue-only evidence on cancellation and leaves the uploaded bytes alone", async () => {
  const { threadId, queued, message, file } = await enqueue();
  expect(portableWorkBotUpload(threadId, message)).toBeTruthy();
  settleChatFollowups([queued.id], "cancelled");
  expect(portableWorkBotUpload(threadId, message)).toBeNull();
  expect(readFileSync(file.path, "utf8")).toBe("synthetic inventory = 42");
});
