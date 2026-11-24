import { describe, expect, it } from "vitest";

import type { Message } from "../store.ts";
import { createPersonStop, type PersonStopDeps, type TypedStop } from "./person-stop.ts";

function world(over: { working?: string[]; asking?: boolean; threads?: string[]; blocked?: string[]; stopFails?: string[]; refused?: string[] } = {}) {
  const rows: Partial<Message>[] = [], stopped: string[] = [];
  const stop = createPersonStop({
    store: {
      appendMessage: (_threadId: string, row: Partial<Message>) => { rows.push(row); return row as Message; },
      bot: () => ({ name: "Ada" }), botByThread: () => undefined, groupByThread: () => undefined, taskByThread: () => undefined,
      tasks: () => (over.threads ?? ["t", "other"]).map((threadId) => ({ threadId })),
    } as unknown as PersonStopDeps["store"],
    routines: () => null, handoffs: () => ({ stoppedByPerson: () => {} }) as never, interruptDirectThread: async (_botId, threadId) => { if (over.stopFails?.includes(threadId)) throw new Error("synthetic stop failure"); stopped.push(threadId); }, stopping: () => () => {},
    assertStopAllowed: threadId => { if (over.blocked?.includes(threadId)) throw new Error("synthetic recovery lock"); },
    stopRefusal: threadId => over.refused?.includes(threadId) ? "not the owner" : null,
    clearUnattended: () => {}, markStopped: () => {}, stopGoal: () => {},
    working: (_botId, threadId) => (over.working ?? []).includes(threadId), asking: () => over.asking === true, language: () => undefined,
  });
  const send = (text: string, input: Partial<TypedStop> = {}) => stop.stopOnTypedCommand({ botId: "b", threadId: "t", text, trigger: { kind: "user" } as TypedStop["trigger"], personPresent: true, fromApp: false, busy: false, row: {}, ...input });
  return { send, rows, stopped };
}

describe("a typed stop", () => {
  it("stops other work and reports an incomplete everyone stop", async () => {
    const w = world({ working: ["t", "other", "third"], threads: ["t", "other", "third"], blocked: ["t"], stopFails: ["other"] });
    expect(await w.send("@everyone stop", { busy: true })).toMatchObject({ ok: true });
    expect(w.stopped).toEqual(["third"]);
    expect(w.rows.at(-1)?.tool?.name).toBe("Stop was attempted where permitted. Check any remaining work.");
  });

  it("reports when an everyone stop cannot stop another person's shared run", async () => {
    const w = world({ working: ["t", "other"], threads: ["t", "other"], refused: ["other"] });
    expect(await w.send("@everyone stop", { busy: true })).toMatchObject({ ok: true });
    expect(w.stopped).toEqual(["t"]);
    expect(w.rows.at(-1)?.tool?.name).toBe("Stop was attempted where permitted. Check any remaining work.");
  });
  it("stops the running turn at once, and is never a message to it", async () => {
    const w = world({ working: ["t"] });
    expect(await w.send("alles stoppen", { busy: true })).toMatchObject({ ok: true });
    expect(w.stopped).toEqual(["t"]);
    expect(w.rows).toEqual([expect.objectContaining({ role: "user", text: "alles stoppen" })]);
  });

  it("stops teammates working for this thread, unless the bot is waiting on the person's answer, when it may be that answer", async () => {
    const working = world({ working: ["t"] });
    expect(await working.send("stop")).toMatchObject({ ok: true });
    expect(working.stopped).toEqual(["t"]);
    const asked = world({ working: ["t"], asking: true });
    expect(await asked.send("stop")).toBeNull();
    expect(asked.stopped).toEqual([]);
  });

  it("goes to the bot as any line does when nothing is running: it may mean what the bot just set up", async () => {
    for (const text of ["stop", "cancel that", "stopp"]) {
      const w = world();
      expect(await w.send(text), text).toBeNull();
      expect(w.rows).toEqual([]);
    }
  });

  it("said to @everyone starts no engine where nothing runs, and says so", async () => {
    const w = world();
    expect(await w.send("@everyone alles stoppen")).toMatchObject({ ok: true });
    expect(w.stopped).toEqual([]);
    expect(w.rows.map((row) => row.tool?.name ?? row.text)).toEqual(["@everyone alles stoppen", "Stop was attempted where permitted. Check any remaining work."]);
  });

  it("said to @everyone stops all of the bot's work, in whichever thread", async () => {
    const w = world({ working: ["other"] });
    expect(await w.send("@everyone stop")).toMatchObject({ ok: true });
    expect(w.stopped).toEqual(["other"]);
    expect(w.rows.at(-1)?.tool?.name).toBe("Stop was attempted where permitted. Check any remaining work.");
  });

  it("leaves a real sentence, another's tag, an app's message, a routine and a spoken line alone", async () => {
    const quiet = async (text: string, input: Partial<TypedStop> = {}, over = {}) => {
      const w = world({ working: ["t"], ...over });
      expect(await w.send(text, { busy: true, ...input }), text).toBeNull();
      expect(w.stopped).toEqual([]);
    };
    await quiet("stop the server and restart it");
    await quiet("stoppen wir das Projekt?");
    await quiet("@Ben stop");
    await quiet("stop", { fromApp: true });
    await quiet("stop", { trigger: { kind: "routine" } as TypedStop["trigger"] });
    const spoken = world({ working: ["t"] });
    expect(await spoken.send("stop", { row: { via: "call" } })).toBeNull();
  });
});
