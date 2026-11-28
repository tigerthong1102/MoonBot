import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DATA_DIR } from "../config.ts";
import { closeMessageDb, workBotLinksForThread } from "../message-db.ts";
import { RoutineRequestService } from "../routine-requests.ts";
import { RoutineManager } from "../routines.ts";
import { flushLaterSaves } from "../save-batch.ts";
import { Store } from "../store.ts";
import { assertWorkBotRoutineSafe } from "./work-bot-routine-guard.ts";

it.each(["delegated", "legacy delegated", "own task"] as const)("refuses a second copy of a held %s schedule after reopening its tasks", async origin => {
  let now = Date.parse("2026-10-01T00:00:00Z");
  const started: string[] = [];
  const openStore = () => new Store(() => ({ instanceId: "claude", model: "fixture" }));
  let store = openStore();
  const file = join(DATA_DIR, `fixture-${origin}.json`);
  const openManager = () => new RoutineManager({
    file, now: () => now,
    botState: () => "ready", goalState: () => "ready",
    createTask: bot => store.createTask(bot, "Fixture run"),
    startTurn: async bot => { started.push(bot); },
    beforeHandoffRoutineCommit: (request, routines, runs) => assertWorkBotRoutineSafe(store, () => "en", request, routines, runs, workBotLinksForThread),
  });
  let routines = openManager();
  const service = () => new RoutineRequestService({ store, routines, now: () => now, workBotLinks: workBotLinksForThread });
  try {
    const source = store.createBot({ name: "Fixture chief" });
    const worker = store.createBot({ name: "Fixture worker" });
    const sibling = store.createTask(worker.id, "Different handoff", false)!;
    const independent = store.createTask(worker.id, "Independent task", false)!;
    const sourceTask = source.threadId, targetTask = worker.threadId;
    const handoff = (targetThreadId: string) => {
      const message = store.appendMessage(sourceTask, { role: "user", kind: "text", text: "Fixture offer" });
      const link = { sourceBotId: source.id, sourceThreadId: sourceTask, sourceMessageId: message.id, targetBotId: worker.id, targetThreadId };
      store.appendLinkedMessages(targetThreadId, [{ sourceId: message.id, message: { role: "user", kind: "text", text: message.text, at: now } }], undefined, link);
      return message.id;
    };
    const offer = handoff(targetTask);
    handoff(sibling.threadId);
    const proposal = { action: "create", routine: { name: "Fixture inventory", instructions: "Count the synthetic stock.", schedule: { type: "interval", everyMinutes: 60 } } };
    const delegated = origin !== "own task";
    const originalOwner = delegated ? { botId: source.id, threadId: sourceTask } : { botId: worker.id, threadId: targetTask };
    const request = (threadId: string) => ({ botId: worker.id, threadId, proposal });
    const pending = await service().propose(request(targetTask));
    const original = await service().submit({
      ...originalOwner, requestMessageId: () => delegated ? offer : undefined,
      proposal: delegated ? { ...proposal, forBot: { botId: worker.id, name: worker.name } } : proposal,
    });
    expect(original.result?.state).toBe("applied");
    routines.holdFor(["no_engine"]);
    routines.close();
    flushLaterSaves();
    closeMessageDb();
    if (origin === "legacy delegated") {
      const data = JSON.parse(readFileSync(file, "utf8"));
      delete data.routines[0].delegatedFromMessageId;
      writeFileSync(file, JSON.stringify(data));
    }
    store = openStore();
    routines = openManager();
    expect(routines.listRoutines()).toMatchObject([{ botId: worker.id, sourceThreadId: originalOwner.threadId, enabled: false, heldFor: "no_engine" }]);
    if (origin === "delegated") {
      expect(routines.listRoutines()[0]?.delegatedFromMessageId).toBe(offer);
      store.clearTaskMessages(source.id, sourceTask);
      expect(store.messagesFor(sourceTask)).toHaveLength(0);
    }
    expect(service().resolve({ botId: worker.id, threadId: targetTask, requestId: pending.requestId, behavior: "allow" })).toMatchObject({ state: "invalid", status: 409 });
    if (origin === "own task") {
      store.clearTaskMessages(worker.id, targetTask);
      expect(store.messagesFor(targetTask)).toHaveLength(0);
    }
    await expect(service().submit(request(targetTask))).rejects.toMatchObject({ status: 409 });
    const applyIndependent = async (threadId: string, candidate = proposal) => {
      const submission = await service().submit({ botId: worker.id, threadId, proposal: candidate });
      expect(submission.result?.state).toBe("applied");
      expect(routines.remove(submission.result!.resultId)).toBe(true);
    };
    await applyIndependent(sibling.threadId);
    await applyIndependent(independent.threadId);
    await applyIndependent(targetTask, { ...proposal, routine: { ...proposal.routine, instructions: "Prepare an unrelated report." } });
    await applyIndependent(targetTask, { ...proposal, routine: { ...proposal.routine, schedule: { type: "interval", everyMinutes: 30 } } });
    routines.holdFor([]);
    now += 3_600_000;
    await routines.tick();
    await new Promise(resolve => setImmediate(resolve));
    expect(started).toEqual([worker.id]);
    const [schedule] = routines.listRoutines();
    expect(routines.listRoutines()).toHaveLength(1);
    routines.update(schedule!.id, { enabled: false });
    await expect(service().propose(request(targetTask))).resolves.toHaveProperty("requestId");
  } finally { routines.close(); }
});
