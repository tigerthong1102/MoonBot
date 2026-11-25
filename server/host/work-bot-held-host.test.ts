import { rmSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { DATA_DIR } from "../config.ts";
import { contextText } from "../delta-context.ts";
import { pendingWorkBotRoutes, pendingWorkBotTargets } from "../message-db.ts";
import { flushLaterSaves } from "../save-batch.ts";
import { Store } from "../store.ts";
import { queueSteeredMessage, restoreSteeredMessages, workBotQueuedFollowups } from "../steer-queue.ts";
import { createWorkBotHost, updateWorkBotRoutingIndex } from "./work-bot-host.ts";

beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); restoreSteeredMessages(); });

it.each(["none", "unlock", "sync"] as const)("stages without starting the bot; cleanup failure=%s remains recoverable", async (failure) => {
  const selection = () => ({ instanceId: "fixture", model: "fake" });
  const store = new Store(selection);
  const source = store.createBot({ name: "Source fixture" }, { seedMessages: false, beforeShown: bot => { bot.defaultBot = {}; } });
  const target = store.createBot({ name: "Target fixture" }, { seedMessages: false });
  store.appendMessage(source.threadId, { role: "user", kind: "text", text: "EARLIER_FIXTURE" });
  store.appendMessage(source.threadId, { role: "bot", kind: "text", text: "EARLIER_RESPONSE_FIXTURE" });
  const message = store.appendMessage(source.threadId, { role: "user", kind: "text", text: "HELD_FIXTURE", workBotRouting: { state: "waiting_choice", requestId: "fixture-choice", sourceBotId: source.id, ownerKey: "", triggerKind: "owner", modelSelection: selection() } });
  const first = queueSteeredMessage(source.id, source.threadId, "FOLLOWUP_ONE_FIXTURE", { workBotOfferSource: message.id, trigger: { kind: "owner" }, sendId: "fixture-send-1" });
  const second = queueSteeredMessage(source.id, source.threadId, "FOLLOWUP_TWO_FIXTURE", { workBotOfferSource: message.id, trigger: { kind: "owner" }, sendId: "fixture-send-2" });
  const pending = new Map<string, Set<string>>([[source.threadId, new Set([message.id])]]);
  const locks = new Map<string, { sourceThreadId: string; messageId: string; cleanupFailed?: boolean }>();
  const startTurn = vi.fn(async () => {});
  const originalPatch = store.patchMessage.bind(store);
  const patch = vi.spyOn(store, "patchMessage").mockImplementation((threadId, messageId, value, command) => failure === "sync" && value.workBotRouting?.state === "held_for_review" ? null : originalPatch(threadId, messageId, value, command));
  const host = createWorkBotHost({
    store, pendingWorkBotIds: pending, workBotTargetLocks: locks,
    indexWorkBotRouting: (threadId, messageId, state) => updateWorkBotRoutingIndex(pending, threadId, messageId, state),
    drainQueuedSends: () => {}, targetUnlocked: () => { if (failure === "unlock") throw new Error("fixture unlock failure"); }, assertAvailable: () => {}, offerWorkBot: () => undefined,
    teamPersonFor: () => undefined, sessionFor: () => undefined, cloudTeam: false, sharedNonTeam: () => false,
    teamHost: { audienceOf: () => "team" }, conversationShares: { isShareKey: () => false },
    threadStarters: { get: () => undefined, setRequired: () => {} }, threadBusy: () => false, approvalMode: () => "full",
    shouldHold: () => true, startTurn,
  });
  const destination = { botId: target.id, threadId: target.threadId };
  expect(await host.workBotRouter.choose(source.threadId, message.id, "fixture-choice", destination)).toBe(failure === "none" ? "accepted" : "interrupted");
  expect(startTurn).not.toHaveBeenCalled();
  expect(store.messagesFor(source.threadId).find(row => row.id === message.id)?.workBotRouting?.state).toBe(failure === "sync" ? "dispatching" : "held_for_review");
  if (failure !== "sync") {
    expect(store.messagesFor(target.threadId).filter(row => row.workBotCopy).map(row => row.text)).toEqual(["EARLIER_FIXTURE", "EARLIER_RESPONSE_FIXTURE"]);
    expect(store.messagesFor(target.threadId).filter(row => row.workBotReviewHold).every(row => !contextText(row).includes("FIXTURE"))).toBe(true);
    expect(store.messagesFor(target.threadId).find(row => row.text === "HELD_FIXTURE")).toMatchObject({ requestPending: false, workBotReviewHold: true });
    expect(store.messagesFor(target.threadId).filter(row => row.queueId).map(row => [row.queueId, row.text, row.workBotReviewHold])).toEqual([[first.id, "FOLLOWUP_ONE_FIXTURE", true], [second.id, "FOLLOWUP_TWO_FIXTURE", true]]);
    expect(workBotQueuedFollowups(source.id, source.threadId, message.id)).toEqual([]);
  }
  expect(pending.has(source.threadId)).toBe(failure !== "none");
  expect(locks.size).toBe(failure === "none" ? 0 : 1);
  expect(host.workBotRouter.hasCleanupFailure(source.threadId, message.id)).toBe(failure !== "none");
  expect(await host.workBotRouter.choose(source.threadId, message.id, "fixture-choice", destination)).toBe("not_claimed");
  expect(pendingWorkBotRoutes()).toEqual([]);
  expect(pendingWorkBotTargets()).toEqual([]);
  flushLaterSaves();
  patch.mockRestore();
  const reopened = new Store(selection);
  restoreSteeredMessages();
  expect(workBotQueuedFollowups(source.id, source.threadId, message.id)).toEqual([]);
  expect(reopened.messagesFor(source.threadId).find(row => row.id === message.id)?.workBotRouting?.state).toBe("held_for_review");
  expect(reopened.messagesFor(target.threadId).some(row => row.text === "HELD_FIXTURE" && row.workBotReviewHold)).toBe(true);
});
