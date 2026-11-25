import { expect, it } from "vitest";
import type { Message, Store } from "../store.ts";
import type { TypedStop } from "./person-stop.ts";
import { createWorkBotTypedStop } from "./work-bot-typed-stop.ts";

it("fences the same send after a partial stop, serialization, and another message", async () => {
  let rows = [{ id: "source", role: "user", kind: "text", at: 1, workBotRouting: { state: "dispatched", targetBotId: "worker", targetThreadId: "target" } }] as Message[];
  const owner = { messageId: "target-message", stopped: false };
  const target = [{ id: "target-message", role: "user", kind: "text", at: 1, sendId: "workbot-source" }] as Message[];
  const store = {
    bot: () => ({ name: "StartupBot" }),
    activePath: () => rows,
    messagesFor: (threadId: string) => threadId === "target" ? target : rows,
    patchMessage: (_threadId: string, id: string, patch: Partial<Message>) => {
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index]!, ...patch };
      return rows[index]!;
    },
  } as unknown as Store;
  let stops = 0;
  const host = createWorkBotTypedStop({ store, team: false, busy: () => false, ownerFor: () => owner, refusal: () => null, activeRoutine: () => false,
    stop: async () => { stops += 1; owner.stopped = true; throw new Error("synthetic interrupt failed after stop began"); },
    stopTyped: async input => { await input.stopHandoff?.(); return null; }, language: () => "en" });
  const input: TypedStop = { botId: "main", threadId: "source-thread", text: "stop", trigger: { kind: "user" }, personPresent: true, fromApp: false, busy: false, row: { sendId: "send-stop" } };
  await expect(host.stop(input)).rejects.toThrow("synthetic interrupt failed");
  expect(stops).toBe(1);
  rows = JSON.parse(JSON.stringify([...rows, { id: "later", role: "user", kind: "text", at: 2, text: "another request" }])) as Message[];
  expect(() => host.assertSafe({ ...input, text: "changed text" })).toThrow();
  expect(() => host.assertSafe({ ...input, row: {} })).toThrow();
  expect(() => host.assertSafe({ ...input, text: "new request", row: { sendId: "new-id" } })).not.toThrow();
  expect(stops).toBe(1);
});
