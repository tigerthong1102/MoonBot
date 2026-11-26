import { expect, it, vi } from "vitest";
import { cleanupWorkBotSetup, hasUncertainWorkBotStop, releaseWorkBotTargetLock } from "./work-bot-host.ts";
import type { Message } from "../store.ts";

it("finishes all setup cleanup steps even when one fails", () => {
  const first = vi.fn(() => { throw new Error("synthetic failure"); });
  const second = vi.fn();
  expect(cleanupWorkBotSetup([first, second])).toBe(false);
  expect(second).toHaveBeenCalledOnce();
});

it("retains a target lock when its completion fence fails", () => {
  const locks = new Map([["target", { sourceThreadId: "source", messageId: "message", cleanupFailed: false }]]);
  expect(() => releaseWorkBotTargetLock(locks, "target", "message", () => { throw new Error("synthetic persistence failure"); })).toThrow();
  expect(locks.get("target")).toMatchObject({ messageId: "message", cleanupFailed: true });
  const settle = vi.fn();
  releaseWorkBotTargetLock(locks, "target", "other-message", settle);
  expect(settle).not.toHaveBeenCalled();
  expect(locks.has("target")).toBe(true);
});

it("fences retries of an uncertain stop even after later messages", () => {
  const rows = JSON.parse(JSON.stringify([
    { id: "source", role: "user", kind: "text", at: 1, workBotRouting: { state: "dispatched", stopPending: { sendId: "stop-1" } } },
    { id: "later", role: "user", kind: "text", at: 2, text: "other work" },
  ])) as Message[];
  expect(hasUncertainWorkBotStop(rows, "stop-1", true)).toBe(true);
  expect(hasUncertainWorkBotStop(rows, "stop-1", false)).toBe(true);
  expect(hasUncertainWorkBotStop(rows, "stop-2", true)).toBe(false);
  expect(hasUncertainWorkBotStop(rows, undefined, true)).toBe(true);
  rows[0]!.workBotRouting!.stopPending = {};
  expect(hasUncertainWorkBotStop(rows, "stop-2", true)).toBe(true);
});
