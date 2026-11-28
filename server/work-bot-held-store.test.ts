import { rmSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import { pendingWorkBotRoutes, pendingWorkBotTargets } from "./message-db.ts";
import { flushLaterSaves } from "./save-batch.ts";
import { Store } from "./store.ts";

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

it("publishes the held state and restores the transferred text without scheduling it", () => {
  const store = new Store(() => ({ instanceId: "fixture", model: "fake" }));
  const sourceBot = store.createBot({ name: "Source fixture" });
  const targetBot = store.createBot({ name: "Target fixture" });
  const source = store.appendMessage(sourceBot.threadId, { role: "user", kind: "text", text: "HELD_FIXTURE", workBotRouting: { state: "dispatching", sourceBotId: sourceBot.id, targetBotId: targetBot.id, targetThreadId: targetBot.threadId } });
  const link = { sourceBotId: sourceBot.id, sourceThreadId: sourceBot.threadId, sourceMessageId: source.id, targetBotId: targetBot.id, targetThreadId: targetBot.threadId };
  const changes: string[] = [];
  const unsubscribe = store.onChange(change => { if (change.type === "message.patch" && change.message.id === source.id) changes.push(change.message.workBotRouting?.state ?? "missing"); });
  const copied = store.appendLinkedMessages(targetBot.threadId, [{ sourceId: source.id, message: { role: "user", kind: "text", text: source.text, at: 1, sendId: `workbot-${source.id}`, requestPending: false, workBotReviewHold: true, workBotHandoffSource: { threadId: sourceBot.threadId, messageId: source.id, botId: sourceBot.id } } }], undefined, link, { expectedSourceLeaf: store.activeLeaf(sourceBot.threadId) });
  unsubscribe();
  expect(changes).toEqual(["held_for_review"]);
  expect(store.messagesFor(sourceBot.threadId).find(row => row.id === source.id)?.workBotRouting?.state).toBe("held_for_review");
  expect(store.messagesFor(targetBot.threadId).find(row => row.id === copied.get(source.id)?.id)).toMatchObject({ text: "HELD_FIXTURE", workBotReviewHold: true });
  expect(pendingWorkBotRoutes()).toEqual([]);
  expect(pendingWorkBotTargets()).toEqual([]);
  flushLaterSaves();
  const reopened = new Store(() => ({ instanceId: "fixture", model: "fake" }));
  expect(reopened.messagesFor(sourceBot.threadId).find(row => row.id === source.id)?.workBotRouting?.state).toBe("held_for_review");
  expect(reopened.messagesFor(targetBot.threadId).find(row => row.id === copied.get(source.id)?.id)).toMatchObject({ text: "HELD_FIXTURE", workBotReviewHold: true });
});

it("keeps the durable hold recoverable if memory synchronization fails after commit", () => {
  const store = new Store(() => ({ instanceId: "fixture", model: "fake" }));
  const sourceBot = store.createBot({ name: "Source fixture" });
  const targetBot = store.createBot({ name: "Target fixture" });
  const source = store.appendMessage(sourceBot.threadId, { role: "user", kind: "text", text: "HELD_FIXTURE", workBotRouting: { state: "dispatching", sourceBotId: sourceBot.id, targetBotId: targetBot.id, targetThreadId: targetBot.threadId } });
  const link = { sourceBotId: sourceBot.id, sourceThreadId: sourceBot.threadId, sourceMessageId: source.id, targetBotId: targetBot.id, targetThreadId: targetBot.threadId };
  const patch = vi.spyOn(store, "patchMessage").mockReturnValueOnce(null);
  const rows = [{ sourceId: source.id, message: { role: "user" as const, kind: "text" as const, text: source.text, at: 1, sendId: `workbot-${source.id}`, requestPending: false, workBotReviewHold: true as const, workBotHandoffSource: { threadId: sourceBot.threadId, messageId: source.id, botId: sourceBot.id } } }];
  expect(() => store.appendLinkedMessages(targetBot.threadId, rows, undefined, link, { expectedSourceLeaf: store.activeLeaf(sourceBot.threadId) })).toThrow(expect.objectContaining({ workBotCleanupFailed: true, workBotHeldCommitted: true }));
  patch.mockRestore();
  flushLaterSaves();
  const reopened = new Store(() => ({ instanceId: "fixture", model: "fake" }));
  expect(reopened.messagesFor(sourceBot.threadId).find(row => row.id === source.id)?.workBotRouting?.state).toBe("held_for_review");
  expect(reopened.messagesFor(targetBot.threadId).some(row => row.text === "HELD_FIXTURE" && row.workBotReviewHold)).toBe(true);
  expect(pendingWorkBotRoutes()).toEqual([]);
  expect(pendingWorkBotTargets()).toEqual([]);
});
