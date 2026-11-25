import { expect, it } from "vitest";
import type { Routine, RoutineRequestCommit, RoutineRun } from "../routines.ts";
import type { Message, Store } from "../store.ts";
import { assertWorkBotRoutineSafe, inspectWorkBotRoutineConflict } from "./work-bot-routine-guard.ts";

it("checks existing source schedules at commit without exposing their contents", () => {
  const root = { id: "root", role: "user", kind: "text", at: 1, workBotRecoveryPending: true, workBotHandoffSource: { threadId: "source-thread", messageId: "source-message", botId: "source-bot" } } as Message;
  const card = { id: "card", role: "bot", kind: "options", at: 2, requestMessageId: "root" } as Message;
  const store = { messagesFor: () => [root, card], activePath: () => [root, card], botByThread: () => null, bot: (id: string) => ({ id }) } as unknown as Store;
  const request = { threadId: "target-thread", messageId: "card" } as RoutineRequestCommit;
  const check = (routines: Partial<Routine>[] = [], runs: Partial<RoutineRun>[] = []) => assertWorkBotRoutineSafe(store, () => "en", request, routines as Routine[], runs as RoutineRun[]);
  expect(() => check()).not.toThrow();
  expect(() => check([{ botId: "other", sourceThreadId: "other-thread", enabled: true }])).not.toThrow();
  expect(() => check([{ botId: "source-bot", enabled: true, name: "PRIVATE_FIXTURE_NAME" }])).toThrow("may overlap");
  expect(() => check([{ botId: "other", sourceThreadId: "source-thread", enabled: true }])).toThrow("may overlap");
  expect(() => check([{ botId: "source-bot", enabled: false }], [{ botId: "source-bot", status: "running" }])).toThrow("may overlap");
  expect(() => check([{ botId: "source-bot", enabled: false }])).not.toThrow();
  for (const heldFor of ["no_engine", "no_connections", "plan_cancelled"] as const) {
    expect(() => check([{ botId: "source-bot", enabled: false, heldFor }])).toThrow("may overlap");
  }
  const steered = { id: "steered", role: "user", kind: "text", at: 3 } as Message;
  const ambiguousCard = { ...card, requestMessageId: undefined };
  const steeredStore = { messagesFor: () => [root, steered, ambiguousCard], activePath: () => [root, steered, ambiguousCard], botByThread: () => null, bot: (id: string) => ({ id }) } as unknown as Store;
  expect(() => assertWorkBotRoutineSafe(steeredStore, () => "en", request, [{ botId: "source-bot", enabled: true } as Routine], [])).toThrow("may overlap");
  const completed = { ...root, workBotRecoveryPending: undefined };
  const laterCard = { ...card, requestMessageId: "steered" };
  const laterStore = { messagesFor: () => [completed, steered, laterCard], activePath: () => [completed, steered, laterCard], botByThread: () => null, bot: (id: string) => ({ id }) } as unknown as Store;
  expect(() => assertWorkBotRoutineSafe(laterStore, () => "en", request, [{ botId: "source-bot", enabled: true } as Routine], [])).toThrow("may overlap");
  const divider = { id: "fresh", role: "bot", kind: "compaction", at: 4, compaction: { fresh: true } } as Message;
  const independentStore = { messagesFor: () => [completed, divider, steered, laterCard], activePath: () => [completed, divider, steered, laterCard], botByThread: () => null, bot: (id: string) => ({ id }) } as unknown as Store;
  expect(() => assertWorkBotRoutineSafe(independentStore, () => "en", request, [{ botId: "source-bot", enabled: true } as Routine], [])).toThrow("may overlap");
  const handed = { id: "source-message", role: "user", kind: "text", at: 1, workBotRouting: { state: "dispatched", targetBotId: "target-bot", targetThreadId: "target-thread" } } as Message;
  const sourceStore = { messagesFor: () => [handed, steered, laterCard], activePath: () => [handed, steered, laterCard], botByThread: () => null, bot: (id: string) => ({ id }) } as unknown as Store;
  const sourceRequest = { ...request, threadId: "source-thread" };
  expect(() => assertWorkBotRoutineSafe(sourceStore, () => "en", sourceRequest, [{ botId: "target-bot", enabled: true } as Routine], [])).toThrow("may overlap");
  expect(() => assertWorkBotRoutineSafe(sourceStore, () => "en", sourceRequest, [{ botId: "unrelated", enabled: true } as Routine], [])).not.toThrow();
});

it("refuses scheduling while a linked bot may restore routines after a move", () => {
  const link = { sourceBotId: "source-bot", sourceThreadId: "source-thread", sourceMessageId: "offer", targetBotId: "target-bot", targetThreadId: "target-thread" };
  const moving = { id: "target-bot", movedTo: { state: "moving", team: { id: "fixture-team", name: "Fixture" }, at: 1 } };
  const store = { messagesFor: () => [], activePath: () => [], botByThread: () => null, bot: (id: string) => id === moving.id ? moving : null } as unknown as Store;
  const request = { threadId: "source-thread", botId: "source-bot", messageId: "card" } as RoutineRequestCommit;
  expect(() => assertWorkBotRoutineSafe(store, () => "en", request, [], [], () => [link])).toThrow("may overlap");
  const movedWithWork = { ...store, bot: () => ({ ...moving, movedTo: { ...moving.movedTo, state: "moved", held: ["routine:fixture"] } }) } as unknown as Store;
  expect(() => assertWorkBotRoutineSafe(movedWithWork, () => "en", request, [], [], () => [link])).toThrow("may overlap");
  const movedEmpty = { ...store, bot: () => ({ ...moving, movedTo: { ...moving.movedTo, state: "moved", held: [] } }) } as unknown as Store;
  expect(() => assertWorkBotRoutineSafe(movedEmpty, () => "en", request, [], [], () => [link])).not.toThrow();
  const deleted = { ...store, bot: () => null } as unknown as Store;
  expect(() => assertWorkBotRoutineSafe(deleted, () => "en", request, [], [], () => [link])).not.toThrow();
});

 it("uses persisted links after either conversation history is cleared", () => {
  const store = { messagesFor: () => [], activePath: () => [], botByThread: () => null, bot: (id: string) => ({ id }) } as unknown as Store;
  const link = { sourceBotId: "source-bot", sourceThreadId: "source-thread", sourceMessageId: "offer", targetBotId: "target-bot", targetThreadId: "target-thread" };
  const links = (id: string, botId: string) => [link].filter(item => item.sourceThreadId === id || item.targetThreadId === id || item.sourceBotId === botId || item.targetBotId === botId);
  const check = (threadId: string, ownerId: string, scheduledBotId: string) => assertWorkBotRoutineSafe(store, () => "en", { threadId, botId: ownerId, messageId: "card" } as RoutineRequestCommit, [{ botId: scheduledBotId, enabled: true } as Routine], [], links);
  expect(() => check("source-thread", "source-bot", "target-bot")).toThrow("may overlap");
  expect(() => check("target-thread", "target-bot", "source-bot")).toThrow("may overlap");
  expect(() => check("fresh-thread", "source-bot", "target-bot")).toThrow("may overlap");
  expect(() => check("fresh-thread", "target-bot", "source-bot")).toThrow("may overlap");
  expect(() => check("source-thread", "target-bot", "source-bot")).toThrow("may overlap");
  expect(() => check("source-thread", "target-bot", "target-bot")).not.toThrow();
  expect(() => check("target-thread", "source-bot", "target-bot")).toThrow("may overlap");
  expect(() => check("independent-thread", "other-bot", "source-bot")).not.toThrow();
});

it("reports and fingerprints a linked bot move in the conflict snapshot", () => {
  let moving = false;
  const link = { sourceBotId: "source-bot", sourceThreadId: "source-thread", sourceMessageId: "offer", targetBotId: "target-bot", targetThreadId: "target-thread" };
  const store = { messagesFor: () => [], activePath: () => [], botByThread: () => null, bot: (id: string) => id === "target-bot" && moving ? { movedTo: { state: "moving", team: { id: "fixture", name: "Fixture" }, at: 1 } } : { id } } as unknown as Store;
  const request = { threadId: "source-thread", botId: "source-bot", messageId: "card" } as RoutineRequestCommit;
  const before = inspectWorkBotRoutineConflict(store, request, [], [], () => [link]);
  moving = true;
  const after = inspectWorkBotRoutineConflict(store, request, [], [], () => [link]);
  expect(before.conflict).toBe(false);
  expect(after.conflict).toBe(true);
  expect(after.fingerprint).not.toBe(before.fingerprint);
});
