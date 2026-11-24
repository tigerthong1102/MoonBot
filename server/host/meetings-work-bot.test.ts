import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RoutineManager } from "../routines.ts";
import type { Store } from "../store.ts";
import { createMeetingsHost } from "./meetings-host.ts";
import { assertWorkBotRoutineSafe } from "./work-bot-routine-guard.ts";

it.each([["source", "target"], ["target", "source"]])("prevents linked bots from creating duplicate meeting routines (%s first)", async (first, second) => {
  const dir = mkdtempSync(join(tmpdir(), "meeting-handoff-"));
  const link = { sourceBotId: "source", sourceThreadId: "source-thread", sourceMessageId: "work-1", targetBotId: "target", targetThreadId: "target-thread" };
  const store = { messagesFor: () => [], activePath: () => [], bot: (id: string) => ({ id, name: id }), botByThread: (id: string) => ({ id: id.split("-")[0] }) } as unknown as Store;
  const manager = new RoutineManager({
    file: join(dir, "routines.json"),
    beforeHandoffRoutineCommit: (request, routines, runs) => assertWorkBotRoutineSafe(store, () => "en", request, routines, runs, (thread, bot) => [link].filter(item => [item.sourceBotId, item.targetBotId].includes(bot) || [item.sourceThreadId, item.targetThreadId].includes(thread))),
    botState: () => "ready", createTask: (bot) => ({ threadId: `${bot}-thread` }), startTurn: async () => {}, isResultsThread: () => true,
  } as ConstructorParameters<typeof RoutineManager>[0]);
  const host = createMeetingsHost({ cfg: {} as never, dataDir: dir, store, routines: () => manager, log: () => {}, threadBusy: () => false } as never, () => ({} as never));
  const call = async (botId: string) => {
    let result: { status: number; body: { text: string } } | undefined;
    await host.internal({ method: "POST", path: "/api/internal/meetings/join", bot: store.bot(botId), threadId: `${botId}-thread`, readBody: async () => ({ every_calendar_meeting: true }), json: (_res: unknown, status: number, body: { text: string }) => { result = { status, body }; } } as never);
    return result!;
  };
  try {
    expect((await call(first)).status).toBe(200);
    expect((await call(first)).body.text).toContain("already set up");
    await expect(call(second)).rejects.toMatchObject({ status: 409, code: "work_bot_schedule_conflict" });
    expect(manager.listRoutines().map(routine => routine.botId)).toEqual([first]);
    expect((await call("independent")).status).toBe(200);
    expect(manager.listRoutines().map(routine => routine.botId).sort()).toEqual([first, "independent"].sort());
  } finally {
    await host.close();
    manager.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
