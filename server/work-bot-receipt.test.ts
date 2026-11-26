import { expect, it } from "vitest";
import type { DirectSendInput } from "./direct-send.ts";
import { newWorkBotReceipt, transferredWorkBotReceipt } from "./work-bot-receipt.ts";

it("acknowledges only the same transferred request without starting another turn", () => {
  const input: DirectSendInput = { botId: "bot", threadId: "thread", sendId: "send-id", text: "Synthetic work", sender: { id: "person", name: "Name" }, trigger: { kind: "user" }, personPresent: true, followUp: "queue" };
  const receipt = newWorkBotReceipt(input.text, input.sender, input.trigger.kind, "target", "message", "source", input.followUp);
  const lookup = () => ({ id: "queue-id", salt: receipt.transfer.salt, fingerprint: receipt.transfer.fingerprint });
  expect(transferredWorkBotReceipt(input, lookup)).toEqual({ ok: true, transferred: true, queueId: "queue-id", threadId: "thread" });
  expect(transferredWorkBotReceipt({ ...input, sender: { id: "person", name: "Renamed" } }, lookup)?.ok).toBe(true);
  for (const change of [{ text: "other" }, { sender: { id: "other", name: "Name" } }, { followUp: "restart" as const }, { mentions: ["other"] }, { dataContext: { cardId: "c_1" } }]) {
    expect(() => transferredWorkBotReceipt({ ...input, ...change }, lookup)).toThrow("sendId already belongs");
  }
  expect(() => transferredWorkBotReceipt(input, () => ({ id: "queue-id", salt: "", fingerprint: "" }))).toThrow("cannot be verified");
});
