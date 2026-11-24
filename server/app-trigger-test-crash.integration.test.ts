import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppTriggerTestReceipts } from "./app-trigger-test-receipts.ts";
import { RoutineManager } from "./routines.ts";

it.each(["before-enqueue", "after-enqueue", "after-expiry-and-eviction"])("never automatically re-executes an uncertain test after crash %s", phase => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-test-crash-"));
  let now = 1_000;
  const journalFile = join(dir, "journal.json"), routineFile = join(dir, "routines.json");
  const options = { file: routineFile, now: () => now, botState: () => "busy" as const, createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0];
  const identity = { actor: "fixture-owner", requestKey: randomUUID(), botId: "bot", triggerId: "trigger", remoteId: "remote", accountId: "account" };
  let routines = new RoutineManager(options);
  try {
    const journal = new AppTriggerTestReceipts(journalFile, () => now);
    const receipt = journal.reserve(identity).receipt;
    const token = journal.begin(identity.actor, receipt.id)!.token;
    const deliveryId = `test_${randomUUID()}`;
    const claimed = journal.claim(token, identity.remoteId, deliveryId)!;
    expect(claimed).toMatchObject({ fresh: true, receipt: { state: "processing" } });
    const input = { webhookId: identity.triggerId, webhookName: "Synthetic", prompt: "Fixture only", botId: identity.botId, runOn: "maus" as const, deliveryId, receivedAt: now, eventSource: "app" as const, receiptScope: "app-test" as const };
    let run: { id: string } | null = null;
    if (phase !== "before-enqueue") {
      expect(journal.beginAdmission(claimed.permit!)).toBe(true);
      run = routines.enqueueWebhook(input);
    }
    if (phase === "after-expiry-and-eviction") routines.cancelQueuedWebhook(identity.triggerId, "Synthetic stop");
    routines.close();
    if (phase === "after-expiry-and-eviction") {
      const saved = JSON.parse(readFileSync(routineFile, "utf8"));
      saved.runs = [];
      writeFileSync(routineFile, JSON.stringify(saved));
    }
    now += 8 * 24 * 60 * 60_000;
    routines = new RoutineManager(options);
    const recovered = new AppTriggerTestReceipts(journalFile, () => now);
    const replay = recovered.processingForReconciliation()[0]!;
    expect(replay).toMatchObject({ eventId: deliveryId, receipt: { state: "processing" }, binding: { triggerId: identity.triggerId } });
    const proof = routines.webhookRunReceipt(replay.binding.triggerId, replay.eventId, "app-test");
    if (phase !== "after-enqueue") {
      expect(proof).toBeNull();
      expect(routines.listRuns()).toHaveLength(0);
      expect(recovered.find(identity.actor, receipt.id)?.state).toBe("processing");
    } else {
      expect(proof?.id).toBe(run!.id);
      expect(recovered.settle(receipt.id, "handled", proof!.id)).toMatchObject({ state: "handled", runId: run!.id });
      expect(routines.listRuns()).toHaveLength(1);
    }
  } finally { routines.close(); rmSync(dir, { recursive: true, force: true }); }
});
