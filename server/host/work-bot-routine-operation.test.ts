import { expect, it } from "vitest";
import { prepareWorkBotRoutineOperation } from "./work-bot-routine-operation.ts";

const workBotRoutineOperationFingerprint = (operation: unknown) => prepareWorkBotRoutineOperation(operation)?.fingerprint ?? null;

it("binds a review to every field of a validated stored operation", () => {
  const operation = { action: "create", routine: { name: "Inventory", instructions: "Private fixture", schedule: { type: "daily", time: "09:00", weekdays: [1, 2] }, runOn: "maus", durationMinutes: 30 } };
  const fingerprint = workBotRoutineOperationFingerprint(operation);
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(workBotRoutineOperationFingerprint({ routine: { durationMinutes: 30, runOn: "maus", schedule: { weekdays: [1, 2], time: "09:00", type: "daily" }, instructions: "Private fixture", name: "Inventory" }, action: "create" })).toBe(fingerprint);
  for (const routine of [{ ...operation.routine, instructions: "Changed" }, { ...operation.routine, schedule: { ...operation.routine.schedule, time: "10:00" } }, { ...operation.routine, runOn: "cloud" }]) {
    expect(workBotRoutineOperationFingerprint({ ...operation, routine })).not.toBe(fingerprint);
  }
  expect(workBotRoutineOperationFingerprint({ ...operation, forBot: { botId: "other", name: "Other" } })).not.toBe(fingerprint);
  expect(workBotRoutineOperationFingerprint({ ...operation, command: "unexpected" })).toBeNull();
  expect(workBotRoutineOperationFingerprint({ ...operation, routine: { ...operation.routine, schedule: { type: "daily", time: "bad", weekdays: [1] } } })).toBeNull();
  const normalized = prepareWorkBotRoutineOperation({ ...operation, routine: { ...operation.routine, name: " Inventory ", instructions: " Private fixture " } });
  expect(normalized?.fingerprint).toBe(fingerprint);
  expect(normalized?.operation).toEqual(operation);
});

it("binds management actions, targets, revisions and nullable updates", () => {
  const base = { action: "update", routineId: "routine_1", expectedUpdatedAt: 5, changes: { timeoutMinutes: null } };
  const fingerprint = workBotRoutineOperationFingerprint(base);
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  for (const changed of [{ ...base, routineId: "routine_2" }, { ...base, expectedUpdatedAt: 6 }, { ...base, forBot: { botId: "other", name: "Other" } }, { ...base, changes: { timeoutMinutes: 15 } }]) {
    expect(workBotRoutineOperationFingerprint(changed)).not.toBe(fingerprint);
  }
  expect(workBotRoutineOperationFingerprint({ ...base, changes: {} })).toBeNull();
  const actions = ["pause", "resume", "run_now", "delete"].map(action => workBotRoutineOperationFingerprint({ action, routineId: "routine_1", expectedUpdatedAt: 5 }));
  expect(actions.every(Boolean)).toBe(true);
  expect(new Set(actions).size).toBe(actions.length);
});
