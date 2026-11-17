import { AsyncResource } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { crashVerdict, currentTurn, FATAL_EXIT_DEADLINE_MS, installCrashGuard, runInTurn, STORM_LIMIT, STORM_WINDOW_MS, withTurnScope } from "./crash-guard.ts";
import type { ProviderInstance } from "./contracts.ts";
import { CRASH_EXIT_CODE } from "./restart.ts";

const peerGone = (code: string) => Object.assign(new Error("socket hang up"), { code });

function rig(turnRunning = true, turnIdentity?: (threadId: string) => object | undefined) {
  const events = new EventEmitter();
  const calls = { failed: [] as string[], shutdown: [] as number[], exit: [] as number[], log: [] as string[] };
  let clock = 0;
  installCrashGuard({
    turnIdentity,
    failTurn: (turn) => { calls.failed.push(turn.threadId); return turnRunning; },
    shutdown: (code) => calls.shutdown.push(code),
    exit: (code) => calls.exit.push(code),
    log: (line) => calls.log.push(line),
    redact: (text) => text.replaceAll("sk-secret", "[redacted]"),
    now: () => clock,
    on: (event, listener) => events.on(event, listener),
  });
  return { calls, raise: (kind: "uncaughtException" | "unhandledRejection", error: unknown) => events.emit(kind, error), tick: (ms: number) => { clock += ms; } };
}

afterEach(() => { vi.useRealTimers(); });

describe("the crash guard's rule", () => {
  it("stops only the turn an error came from, keeps the server up for a rejection or a peer gone, and closes for anything else", () => {
    const turn = { botId: "b", threadId: "t" };
    expect(crashVerdict("exception", new TypeError("x"), turn, 1)).toBe("fail-turn");
    expect(crashVerdict("rejection", new TypeError("x"), turn, 1)).toBe("fail-turn");
    expect(crashVerdict("rejection", new TypeError("x"), undefined, 1)).toBe("keep");
    expect(crashVerdict("exception", peerGone("EPIPE"), undefined, 1)).toBe("keep");
    expect(crashVerdict("exception", peerGone("ECONNRESET"), undefined, 1)).toBe("keep");
    expect(crashVerdict("exception", new TypeError("x"), undefined, 1)).toBe("exit");
    expect(crashVerdict("exception", new RangeError("Maximum call stack size exceeded"), turn, 1)).toBe("exit");
    expect(crashVerdict("rejection", new TypeError("x"), turn, STORM_LIMIT + 1)).toBe("exit");
  });

  it("knows the turn an error came from across a timer and a promise started inside it", async () => {
    const seen: Array<string | undefined> = [];
    await runInTurn({ botId: "b", threadId: "t1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(currentTurn()?.threadId);
      await Promise.resolve().then(() => seen.push(currentTurn()?.threadId));
    });
    seen.push(currentTurn()?.threadId);
    expect(seen).toEqual(["t1", "t1", undefined]);
  });
});

describe("installCrashGuard", () => {
  it("rejects a stale execution after the watchdog starts another turn before its driver dispatch", async () => {
    vi.useFakeTimers();
    let watched: object = {};
    const { calls, raise } = rig(true, () => watched);
    const instance = withTurnScope({ adapter: {
      sendTurn: async () => {
        setTimeout(AsyncResource.bind(() => raise("uncaughtException", new Error("old execution"))), 1);
        return { turnId: "old" };
      }, onEvent: () => () => {},
    } } as unknown as Pick<ProviderInstance, "adapter">);
    await instance.adapter.sendTurn({ threadId: "watchdog-generation", botId: "b" } as never);
    watched = {};
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.failed).toEqual([]);
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
  });

  it.each([false, true])("a stale driver callback cannot fail a newer turn, including after an engine switch: %s", async (switchEngine) => {
    vi.useFakeTimers();
    const { calls, raise } = rig();
    const adapter = () => withTurnScope({ adapter: {
      sendTurn: async (input: { threadId: string; text: string }) => {
        if (input.text === "first") setTimeout(AsyncResource.bind(() => raise("uncaughtException", new Error("old callback"))), 10);
        return { turnId: input.text };
      }, onEvent: () => () => {},
    } } as unknown as Pick<ProviderInstance, "adapter">);
    const first = adapter(), second = switchEngine ? adapter() : first;
    const threadId = `stale-${switchEngine}`;
    await first.adapter.sendTurn({ threadId, botId: "b", text: "first" } as never);
    await second.adapter.sendTurn({ threadId, botId: "b", text: "second" } as never);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.failed).toEqual([]);
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
  });

  it("fails the current driver execution but treats a completed execution's late error as fatal", async () => {
    vi.useFakeTimers();
    const { calls, raise } = rig();
    let emit: (event: never) => void = () => {};
    const instance = withTurnScope({ adapter: {
      sendTurn: async () => {
        setTimeout(AsyncResource.bind(() => raise("uncaughtException", new Error("current"))), 1);
        setTimeout(AsyncResource.bind(() => emit({ type: "turn.completed", threadId: "completed-scope", turnId: "one" } as never)), 2);
        setTimeout(AsyncResource.bind(() => raise("uncaughtException", new Error("late"))), 3);
        return { turnId: "one" };
      }, onEvent: (listener: (event: never) => void) => { emit = listener; return () => {}; },
    } } as unknown as Pick<ProviderInstance, "adapter">);
    instance.adapter.onEvent(() => {});
    await instance.adapter.sendTurn({ threadId: "completed-scope", botId: "b" } as never);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.failed).toEqual(["completed-scope"]);
    expect(calls.shutdown).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls.failed).toEqual(["completed-scope"]);
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
  });

  it("stops the turn and keeps the server up when a turn's own work throws or rejects", async () => {
    const { calls, raise } = rig();
    await runInTurn({ botId: "b", threadId: "t1" }, async () => {
      await Promise.resolve();
      raise("uncaughtException", new TypeError("cannot read properties of undefined (sk-secret)"));
      raise("unhandledRejection", new Error("later"));
    });
    expect(calls.failed).toEqual(["t1", "t1"]);
    expect(calls.shutdown).toEqual([]);
    expect(calls.exit).toEqual([]);
    expect(calls.log[0]).toContain("uncaught exception in the turn of bot b thread t1: TypeError: cannot read properties of undefined ([redacted])");
    expect(calls.log[0]).not.toContain("sk-secret");
  });

  it("closes when the turn an error is filed under is no longer running: nothing was stopped, so nothing is known to be whole", async () => {
    vi.useFakeTimers();
    const { calls, raise } = rig(false);
    await runInTurn({ botId: "b", threadId: "warm" }, async () => { raise("uncaughtException", new TypeError("late callback")); });
    expect(calls.failed).toEqual(["warm"]);
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
    expect(calls.log[1]).toContain("no running turn of thread warm to stop");
  });

  it("files only a driver's own work under a turn: what it hands the server through its events runs outside the turn", async () => {
    const seen: Array<string | undefined> = [];
    let emit: (event: never) => void = () => {};
    const instance = withTurnScope({ adapter: {
      sendTurn: async () => { seen.push(currentTurn()?.threadId); await Promise.resolve(); setTimeout(() => emit({} as never), 1); return { turnId: "t9" }; },
      onEvent: (listener: (event: never) => void) => { emit = listener; return () => {}; },
    } } as unknown as Pick<ProviderInstance, "adapter">);
    instance.adapter.onEvent(() => seen.push(currentTurn()?.threadId ?? "outside"));
    await instance.adapter.sendTurn({ threadId: "t9", botId: "b" } as never);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual(["t9", "outside"]);
  });

  it("logs a rejection outside any turn and a peer that went away, and stays up", () => {
    const { calls, raise } = rig();
    raise("unhandledRejection", new Error("fetch failed"));
    raise("uncaughtException", peerGone("EPIPE"));
    expect(calls.log).toHaveLength(2);
    expect(calls.log[1]).toContain("[EPIPE]");
    expect(calls.shutdown).toEqual([]);
  });

  it("closes cleanly with the crash code on an error it cannot place, and exits anyway if the close hangs or fails again", () => {
    vi.useFakeTimers();
    const { calls, raise } = rig();
    raise("uncaughtException", new TypeError("x is not a function"));
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
    expect(calls.exit).toEqual([]);
    vi.advanceTimersByTime(FATAL_EXIT_DEADLINE_MS);
    expect(calls.exit).toEqual([CRASH_EXIT_CODE]);
    raise("unhandledRejection", new Error("during the close"));
    expect(calls.exit).toEqual([CRASH_EXIT_CODE, CRASH_EXIT_CODE]);
    expect(calls.shutdown).toHaveLength(1);
  });

  it("closes when errors keep coming, even ones it would survive alone; a quiet minute resets the count", () => {
    vi.useFakeTimers();
    const { calls, raise, tick } = rig();
    for (let i = 0; i < STORM_LIMIT; i++) raise("unhandledRejection", new Error(`e${i}`));
    tick(STORM_WINDOW_MS + 1);
    for (let i = 0; i < STORM_LIMIT; i++) raise("unhandledRejection", new Error(`f${i}`));
    expect(calls.shutdown).toEqual([]);
    raise("unhandledRejection", new Error("one too many"));
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
  });
});

describe("the crash guard in a real process", () => {
  const run = async (body: string) => {
    const { spawn } = await import("node:child_process");
    const guard = new URL("./crash-guard.ts", import.meta.url).href;
    const script = `import { installCrashGuard, runInTurn } from ${JSON.stringify(guard)};
      installCrashGuard({ failTurn: (turn) => { console.log("failed " + turn.threadId); return true; }, shutdown: (code) => { console.log("closing"); setTimeout(() => process.exit(code), 10); }, log: (line) => console.log(line.split("\\n")[0]) });
      ${body}`;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    return { code, out };
  };

  it("stays up through a turn's own error and exits after its work, and closes with the crash code on an error outside any turn", async () => {
    const survived = await run(`runInTurn({ botId: "b", threadId: "t" }, () => setTimeout(() => { throw new TypeError("boom"); }, 5)); setTimeout(() => { console.log("still up"); }, 50);`);
    expect(survived.code).toBe(0);
    expect(survived.out).toContain("failed t");
    expect(survived.out).toContain("still up");
    const fatal = await run(`setTimeout(() => { throw new TypeError("boom"); }, 5); setTimeout(() => console.log("never"), 5_000);`);
    expect(fatal.code).toBe(CRASH_EXIT_CODE);
    expect(fatal.out).toContain("closing");
    expect(fatal.out).not.toContain("never");
  }, 30_000);
});
