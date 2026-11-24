import { expect, it, vi } from "vitest";
import { cleanupWorkBotSetup, releaseWorkBotTargetLock } from "./work-bot-host.ts";

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
