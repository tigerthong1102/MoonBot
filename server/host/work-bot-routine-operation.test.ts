import { expect, it } from "vitest";
import { workBotRoutineOperationFingerprint } from "./work-bot-routine-operation.ts";

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
});
