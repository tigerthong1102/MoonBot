import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readRoutineFile } from "./routine-file.ts";
import { RoutineManager } from "./routines.ts";

it.each(["message-first", "test-first"])("keeps a synthetic test and an ordinary event with the same ID distinct (%s)", order => {
  const dir = mkdtempSync(join(tmpdir(), "routine-scoped-event-"));
  const options = { file: join(dir, "routines.json"), botState: () => "busy" as const, createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0];
  const deliveryId = `test_${randomUUID()}`;
  const input = { webhookId: "trigger", webhookName: "Fixture", prompt: "Synthetic", botId: "bot", runOn: "maus" as const, deliveryId, receivedAt: Date.now(), eventSource: "app" as const };
  let manager = new RoutineManager(options);
  try {
    const message = () => manager.enqueueWebhook(input);
    const test = () => manager.enqueueWebhook({ ...input, receiptScope: "app-test" });
    const first = order === "message-first" ? message() : test();
    const second = order === "message-first" ? test() : message();
    expect(first.id).not.toBe(second.id);
    expect(manager.listRuns()).toHaveLength(2);
    manager.close();
    manager = new RoutineManager(options);
    expect(message().id).toBe(order === "message-first" ? first.id : second.id);
    expect(test().id).toBe(order === "test-first" ? first.id : second.id);
    expect(manager.listRuns()).toHaveLength(2);
  } finally { manager.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("fails closed when scoped receipts or their primary run contradict each other", () => {
  const dir = mkdtempSync(join(tmpdir(), "routine-scoped-corrupt-"));
  const file = join(dir, "routines.json");
  const options = { file, botState: () => "busy" as const, createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0];
  const manager = new RoutineManager(options);
  try {
    manager.enqueueWebhook({ webhookId: "trigger", webhookName: "Fixture", prompt: "Synthetic", botId: "bot", runOn: "maus", deliveryId: `test_${randomUUID()}`, receivedAt: Date.now(), eventSource: "app", receiptScope: "app-test" });
    manager.close();
    const original = JSON.parse(readFileSync(file, "utf8"));
    const variants = [
      (v: any) => { v.webhookRunReceipts[0].scope = "invalid"; },
      (v: any) => { v.webhookRunReceipts.push({ ...v.webhookRunReceipts[0], runId: "different" }); },
      (v: any) => { v.webhookRunReceipts[0].runId = "different"; },
      (v: any) => { v.runs[0].receiptScope = "invalid"; },
    ];
    for (const mutate of variants) {
      const value = structuredClone(original); mutate(value);
      writeFileSync(file, JSON.stringify(value));
      expect(readRoutineFile(file, Date.now()).state).toBe("unreadable");
    }
  } finally { manager.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("retains the scoped receipt when a test merges into an ordinary queued run", () => {
  const dir = mkdtempSync(join(tmpdir(), "routine-scoped-merge-"));
  const options = { file: join(dir, "routines.json"), botState: () => "busy" as const, createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0];
  const id = `test_${randomUUID()}`;
  let manager = new RoutineManager(options);
  try {
    const first = manager.enqueueWebhook({ webhookId: "trigger", webhookName: "Fixture", prompt: "Synthetic", botId: "bot", runOn: "maus", deliveryId: "ordinary", receivedAt: Date.now(), eventSource: "app" });
    expect(manager.mergeIntoQueuedRun("trigger", id, false, prompt => `${prompt}\nfixture`, "app-test")).toEqual({ id: first.id });
    manager.close();
    manager = new RoutineManager(options);
    expect(manager.webhookRunReceipt("trigger", id, "app-test")?.id).toBe(first.id);
    expect(manager.webhookRunReceipt("trigger", id)).toBeNull();
  } finally { manager.close(); rmSync(dir, { recursive: true, force: true }); }
});
