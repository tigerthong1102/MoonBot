import { expect, it } from "vitest";
import { loadEventReceipts } from "./routine-event-receipts.ts";

it("keeps legacy event receipts and recovers their owner when a run remains", () => {
  const receipt = { webhookId: "old-trigger", deliveryId: "event", runId: "run", acceptedAt: 1000 };
  const runs = [{ id: "run", webhookId: "old-trigger", deliveryId: "event", createdAt: 1000, botId: "bot", eventSource: "app" as const }];
  expect(loadEventReceipts([receipt], runs, 1000)).toEqual([{ ...receipt, botId: "bot", eventSource: "app" }]);
  expect(loadEventReceipts([receipt], [], 1000)).toEqual([receipt]);
});
