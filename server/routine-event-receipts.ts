// Which run each outside event (a webhook delivery or a connected-app event) went to, kept 7 days so a retry of the
// same event is answered with the same run instead of starting another.
import { z } from "zod";

const receiptSchema = z.object({
  webhookId: z.string().min(1).max(200),
  deliveryId: z.string().min(1).max(200),
  runId: z.string().min(1),
  acceptedAt: z.number().finite().nonnegative(),
  scope: z.literal("app-test").optional(),
});
export type EventRunReceipt = z.infer<typeof receiptSchema>;
export const EVENT_RETRY_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const MAX_EVENT_RECEIPTS = 20_000;

/** The saved receipts, plus one for each recent run that names its event but lost its receipt. */
export function loadEventReceipts(
  saved: unknown,
  runs: ReadonlyArray<{ id: string; webhookId?: string; deliveryId?: string; createdAt: number; receiptScope?: "app-test" }>,
  now: number,
): EventRunReceipt[] {
  const receipts = Array.isArray(saved) ? saved.flatMap((receipt) => {
    const parsed = receiptSchema.safeParse(receipt);
    if (!parsed.success && receipt && typeof receipt === "object" && "scope" in receipt) throw new Error("Invalid scoped event receipt");
    return parsed.success ? [parsed.data] : [];
  }) : [];
  const seen = new Map<string, EventRunReceipt>();
  for (const receipt of receipts) {
    const key = JSON.stringify([receipt.webhookId, receipt.scope ?? null, receipt.deliveryId]);
    if (seen.has(key) && receipt.scope === "app-test") throw new Error("Duplicate scoped event receipt");
    seen.set(key, receipt);
    if (receipt.scope === "app-test") {
      const owner = runs.find(run => run.id === receipt.runId);
      const primary = runs.find(run => run.webhookId === receipt.webhookId && run.receiptScope === receipt.scope && run.deliveryId === receipt.deliveryId);
      if ((owner && owner.webhookId !== receipt.webhookId) || (primary && primary.id !== receipt.runId)) throw new Error("Scoped event receipt conflicts with its run");
    }
  }
  const known = new Set(receipts.map((receipt) => JSON.stringify([receipt.webhookId, receipt.scope ?? null, receipt.deliveryId])));
  for (const run of runs) {
    if (run.receiptScope !== undefined && run.receiptScope !== "app-test") throw new Error("Invalid event receipt scope");
    if (!run.webhookId || !run.deliveryId || run.createdAt < now - EVENT_RETRY_WINDOW_MS) continue;
    const key = JSON.stringify([run.webhookId, run.receiptScope ?? null, run.deliveryId]);
    if (known.has(key)) continue;
    receipts.push({ webhookId: run.webhookId, deliveryId: run.deliveryId, runId: run.id, acceptedAt: run.createdAt, ...(run.receiptScope ? { scope: run.receiptScope } : {}) });
    known.add(key);
  }
  return receipts;
}
