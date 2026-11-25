import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createBotMoves } from "../bot-moves.ts";
import { RoutineManager, type RoutineRequestCommit } from "../routines.ts";
import type { BotRecord, Store } from "../store.ts";
import { assertWorkBotRoutineSafe } from "./work-bot-routine-guard.ts";

it("does not add a linked schedule while another bot's move can restore its schedule", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-moving-routine-fixture-"));
  let now = Date.parse("2026-10-01T00:00:00Z"), next = 0;
  const started: string[] = [];
  const bots = new Map<string, BotRecord>([["source", { id: "source", name: "Synthetic main" } as BotRecord], ["target", { id: "target", name: "Synthetic bot" } as BotRecord]]);
  const store = { bot: (id: string) => bots.get(id), patchBot: (id: string, patch: Partial<BotRecord>) => { const bot = bots.get(id); if (bot) Object.assign(bot, patch); return bot ?? null; },
    messagesFor: () => [], activePath: () => [], botByThread: () => undefined } as unknown as Store;
  const links = () => [{ sourceBotId: "source", sourceThreadId: "home", sourceMessageId: "offer", targetBotId: "target", targetThreadId: "new" }];
  const request = { requestId: "fixture-request", messageId: "fixture-card", botId: "source", threadId: "home", action: "create" as const, fingerprintVersion: 1 as const, fingerprint: "a".repeat(64) } satisfies RoutineRequestCommit;
  const manager = new RoutineManager({ file: join(directory, "routines.json"), now: () => now, botState: () => "ready", goalState: () => "ready",
    createTask: () => ({ threadId: `fake-${++next}` }), startTurn: async bot => { started.push(bot); },
    beforeHandoffRoutineCommit: (current, routines, runs) => assertWorkBotRoutineSafe(store, () => "en", current, routines, runs, links),
  });
  try {
    const moves = createBotMoves({ store, routines: () => manager, webhooks: () => null, appEvents: () => null, waits: () => null, busy: () => false, now: () => now });
    const work = { name: "Fixture job", prompt: "Fixture only", enabled: true, schedule: { type: "interval" as const, everyMinutes: 60, anchorAt: now + 3_600_000 } };
    manager.create({ ...work, botId: "target" });
    await moves.hold("target", { id: "fixture-team", name: "Fixture" });
    expect(() => manager.create({ ...work, botId: "source" }, request)).toThrow(/may overlap/);
    await moves.release("target");
    now += 3_600_000;
    await manager.tick();
    await new Promise(resolve => setImmediate(resolve));
    expect(started).toEqual(["target"]);
    expect(manager.listRuns().filter(run => run.botId === "source")).toHaveLength(0);
  } finally { manager.close(); rmSync(directory, { recursive: true, force: true }); }
});
