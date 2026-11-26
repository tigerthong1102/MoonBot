import { expect, it, vi } from "vitest";
import type { Store } from "../store.ts";
import { workflowAutoDecision, workflowCwd } from "./host.ts";

it("uses the room's pinned folder for workflow commands", () => {
  const pin = vi.fn(() => "/fixture/room");
  const store = { groupByThread: () => ({ id: "room" }), pinGroupCwd: pin, taskByThread: () => ({ cwd: "/fixture/task" }), bot: () => ({ cwd: "/fixture/bot" }) } as unknown as Store;
  expect(workflowCwd(store, () => "/fixture/workspace", "bot", "thread")).toBe("/fixture/room");
  expect(pin).toHaveBeenCalledWith("room", "thread");
});

it("uses Full access while retaining the live safety floor", () => {
  const floor = { blocked: (command: string) => command === "blocked", clears: (command: string) => command !== "unreadable" };
  expect(workflowAutoDecision("ask", "app", {}, floor)).toBe("ask");
  expect(workflowAutoDecision("full", "app", {}, floor)).toBe("allow");
  expect(workflowAutoDecision("full", "shell", { command: "blocked" }, floor)).toBe("deny");
  expect(workflowAutoDecision("full", "shell", { command: "unreadable" }, floor)).toBe("ask");
  expect(workflowAutoDecision("full", "shell", { command: "echo ok" }, floor)).toBe("allow");
});
