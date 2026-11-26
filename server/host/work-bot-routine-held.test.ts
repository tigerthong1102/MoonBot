import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RoutineManager, type RoutineRequestCommit } from "../routines.ts";
import type { Store } from "../store.ts";
import { assertWorkBotRoutineSafe } from "./work-bot-routine-guard.ts";

it("refuses a duplicate while the linked schedule can resume automatically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-held-routine-fixture-"));
  let now = Date.parse("2026-10-01T00:00:00Z"), next = 0;
  const started: string[] = [];
  const store = { messagesFor: () => [], activePath: () => [], botByThread: () => undefined, bot: (id: string) => ({ id }) } as unknown as Store;
  const links = () => [{ sourceBotId: "source", sourceThreadId: "home", sourceMessageId: "offer", targetBotId: "target", targetThreadId: "new" }];
  const request = { requestId: "fixture-request", messageId: "fixture-card", botId: "target", threadId: "new", action: "create" as const, fingerprintVersion: 1 as const, fingerprint: "a".repeat(64) } satisfies RoutineRequestCommit;
  const manager = new RoutineManager({ file: join(directory, "routines.json"), now: () => now, botState: () => "ready", goalState: () => "ready",
    createTask: () => ({ threadId: `fake-${++next}` }), startTurn: async bot => { started.push(bot); },
    beforeHandoffRoutineCommit: (current, routines, runs) => assertWorkBotRoutineSafe(store, () => "en", current, routines, runs, links),
  });
  try {
    const work = { name: "Fixture job", prompt: "Fixture only", enabled: true, schedule: { type: "interval" as const, everyMinutes: 60, anchorAt: now + 3_600_000 } };
    manager.create({ ...work, botId: "source" });
    manager.holdFor(["no_engine"]);
    expect(manager.listRoutines()[0]).toMatchObject({ enabled: false, heldFor: "no_engine" });
    expect(() => manager.create({ ...work, botId: "target" }, request)).toThrow(/may overlap/);
    manager.holdFor([]);
    now += 3_600_000;
    await manager.tick();
    await new Promise(resolve => setImmediate(resolve));
    expect(started).toEqual(["source"]);
    expect(manager.listRuns().filter(run => run.botId === "target")).toHaveLength(0);
  } finally { manager.close(); rmSync(directory, { recursive: true, force: true }); }
});

it("allows a new schedule after the person explicitly pauses the held source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-paused-routine-fixture-"));
  const now = Date.parse("2026-10-01T00:00:00Z"), started: string[] = [];
  const store = { messagesFor: () => [], activePath: () => [], botByThread: () => undefined, bot: (id: string) => ({ id }) } as unknown as Store;
  const links = () => [{ sourceBotId: "source", sourceThreadId: "home", sourceMessageId: "offer", targetBotId: "target", targetThreadId: "new" }];
  const request = { requestId: "fixture-request", messageId: "fixture-card", botId: "target", threadId: "new", action: "create" as const, fingerprintVersion: 1 as const, fingerprint: "a".repeat(64) } satisfies RoutineRequestCommit;
  const manager = new RoutineManager({ file: join(directory, "routines.json"), now: () => now, botState: () => "ready", goalState: () => "ready",
    createTask: () => ({ threadId: "fake-thread" }), startTurn: async bot => { started.push(bot); },
    beforeHandoffRoutineCommit: (current, routines, runs) => assertWorkBotRoutineSafe(store, () => "en", current, routines, runs, links),
  });
  try {
    const work = { name: "Fixture job", prompt: "Fixture only", enabled: true, schedule: { type: "interval" as const, everyMinutes: 60, anchorAt: now + 3_600_000 } };
    const source = manager.create({ ...work, botId: "source" });
    manager.holdFor(["no_engine"]);
    manager.update(source.id, { enabled: false });
    expect(manager.listRoutines().find(routine => routine.id === source.id)?.heldFor).toBeUndefined();
    manager.create({ ...work, botId: "target" }, request);
    manager.holdFor([]);
    expect(manager.listRoutines().find(routine => routine.id === source.id)?.enabled).toBe(false);
    expect(manager.listRoutines().find(routine => routine.botId === "target")?.enabled).toBe(true);
    expect(started).toEqual([]);
  } finally { manager.close(); rmSync(directory, { recursive: true, force: true }); }
});
