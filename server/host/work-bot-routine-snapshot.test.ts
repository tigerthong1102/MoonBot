import { expect, it } from "vitest";
import type { Routine, RoutineRun } from "../routines.ts";
import { workBotRoutineSnapshot } from "./work-bot-routine-snapshot.ts";

it("captures linked schedules and active runs without exposing their content", () => {
  const links = [{ botId: "source", threadId: "thread" }];
  const routine = { id: "r1", botId: "source", enabled: true, updatedAt: 1, nextRunAt: 42, prompt: "private fixture", target: "bot", schedule: { type: "daily", time: "09:00", weekdays: [1] } } as Routine;
  const run = { id: "run1", routineId: "r1", botId: "source", status: "running", scheduledFor: 50 } as RoutineRun;
  const current = workBotRoutineSnapshot("target", links, [routine], [run]);
  expect(current).toMatchObject({ conflict: true, hasResolvedLinks: true, hasCompleteRecords: true, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(JSON.stringify(current)).not.toContain("private fixture");
  expect(workBotRoutineSnapshot("target", links, [routine], [run]).fingerprint).toBe(current.fingerprint);
  for (const changed of [{ ...routine, enabled: false }, { ...routine, updatedAt: 2 }, { ...routine, nextRunAt: 43 }]) {
    expect(workBotRoutineSnapshot("target", links, [changed], [run]).fingerprint).not.toBe(current.fingerprint);
  }
  expect(workBotRoutineSnapshot("target", links, [routine], [{ ...run, status: "completed" }]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [routine], [{ ...run, prompt: "changed run" }]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [routine], [{ ...run, retryAt: 55 }]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [routine], [{ ...run, manual: true }]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [routine], [{ ...run, sameConversation: true }]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [routine], [{ ...run, deliveryId: "delivery" }]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [{ ...routine, prompt: "private changed without revision" }], [run]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [{ ...routine, schedule: { type: "daily", time: "10:00", weekdays: [1] } }], [run]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", links, [routine], [{ ...run, seenAt: 12, output: "private output" }]).fingerprint).toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", [...links, { botId: "second", threadId: "t2" }], [routine], [run]).fingerprint).not.toBe(current.fingerprint);
  expect(workBotRoutineSnapshot("target", [{ threadId: "unknown" }], [], [])).toMatchObject({ conflict: true, hasResolvedLinks: false });
  expect(workBotRoutineSnapshot("target", links, [{ ...routine, enabled: false }], []).conflict).toBe(false);
});

it("marks malformed linked records incomplete without throwing", () => {
  const links = [{ botId: "source", threadId: "thread" }];
  const incomplete = [{ botId: "source", enabled: false }, { id: null, botId: "source", enabled: false }] as unknown as Routine[];
  expect(workBotRoutineSnapshot("target", links, incomplete, [])).toMatchObject({ hasCompleteRecords: false });
  const badRun = [{ botId: "source", status: "running" }] as RoutineRun[];
  expect(workBotRoutineSnapshot("target", links, [], badRun)).toMatchObject({ conflict: true, hasCompleteRecords: false });
  expect(workBotRoutineSnapshot("target", links, [{} as Routine], [])).toMatchObject({ hasCompleteRecords: false });
  expect(workBotRoutineSnapshot("target", links, [], [{ id: "r", botId: "source", status: "unknown" } as unknown as RoutineRun])).toMatchObject({ hasCompleteRecords: false });
  const duplicate = { id: "same", botId: "source", enabled: false, updatedAt: 1, nextRunAt: null, target: "bot", schedule: { type: "daily", time: "09:00", weekdays: [1] } } as Routine;
  expect(workBotRoutineSnapshot("target", links, [duplicate], [])).toMatchObject({ hasCompleteRecords: true });
  expect(workBotRoutineSnapshot("target", links, [duplicate, duplicate], [])).toMatchObject({ hasCompleteRecords: false });
  expect(workBotRoutineSnapshot("target", links, [duplicate], [{ id: "run", routineId: "missing", botId: "source", scheduledFor: 2, status: "running" } as RoutineRun])).toMatchObject({ hasCompleteRecords: false });
});
