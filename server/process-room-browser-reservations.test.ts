import { afterEach, describe, expect, it, vi } from "vitest";
import * as processSampler from "./perf/process-sampler.ts";
import { BROWSER_NO_ROOM, BROWSER_TASKS, ProcessBudget } from "./process-room.ts";

describe("per-session browser process reservations", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("does not let an oversized reserved browser offset another reserved browser's startup", async () => {
    vi.useFakeTimers();
    const measured = new Map([["large", BROWSER_TASKS * 2], ["starting", 1]]);
    const running = new Set(measured.keys());
    const budget = new ProcessBudget({ read: () => ({ max: 650, current: 361 }),
      browserTasks: (sessions) => sessions.reduce((sum, session) => sum + (measured.get(session) ?? 0), 0), log: () => {} });
    const browsers = budget.browserRoom((session) => running.has(session));
    budget.reserveBrowser("large");
    budget.reserveBrowser("starting");
    expect(budget.short(BROWSER_TASKS, 0)).toBe(true);
    const third = browsers.enter("third");
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await third).toBe(BROWSER_NO_ROOM);
    running.delete("starting");
    budget.releaseBrowser("starting");
    expect(budget.short(BROWSER_TASKS, 0)).toBe(false);
    expect(await browsers.enter("third")).toBeNull();
  });

  it("does not charge a completed reservation twice when another reserved browser is oversized", () => {
    const measured = new Map([["large", BROWSER_TASKS * 2], ["ready", BROWSER_TASKS]]);
    const budget = new ProcessBudget({ read: () => ({ max: 1000, current: 530 }),
      browserTasks: (sessions) => sessions.reduce((sum, session) => sum + (measured.get(session) ?? 0), 0), log: () => {} });
    budget.browserRoom(() => true);
    budget.reserveBrowser("large");
    budget.reserveBrowser("ready");
    expect(budget.short(BROWSER_TASKS, 0)).toBe(false);
  });

  it("keeps an unmeasurable reservation held beside an oversized browser", () => {
    const budget = new ProcessBudget({ read: () => ({ max: 650, current: 361 }),
      browserTasks: (sessions) => sessions.includes("unknown") ? null : BROWSER_TASKS * 2, log: () => {} });
    budget.browserRoom(() => true);
    budget.reserveBrowser("large");
    budget.reserveBrowser("unknown");
    expect(budget.short(BROWSER_TASKS, 0)).toBe(true);
  });

  it("samples reserved browser trees from one process snapshot per cache refresh", () => {
    const row = (pid: number, threads: number) => ({ pid, ppid: 1, threads, name: "chrome", cpuMs: 0, rssBytes: 0, start: "1" });
    const sample = vi.spyOn(processSampler, "linuxProcessList").mockReturnValue({ rows: [row(2_147_483_648, 340), row(2_147_483_649, 1)], reapedMs: null, totalMs: null });
    try {
      const budget = new ProcessBudget({ read: () => ({ max: 650, current: 361 }), now: () => 0, log: () => {} });
      budget.browserRoom(() => true, (session) => session === "large" ? 2_147_483_648 : 2_147_483_649);
      budget.reserveBrowser("large");
      budget.reserveBrowser("starting");
      expect(budget.short(BROWSER_TASKS, 0)).toBe(true);
      expect(budget.short(BROWSER_TASKS, 0)).toBe(true);
      expect(sample).toHaveBeenCalledTimes(1);
      budget.releaseBrowser("starting");
      expect(budget.short(BROWSER_TASKS, 0)).toBe(false);
      expect(sample).toHaveBeenCalledTimes(2);
    } finally { sample.mockRestore(); }
  });

  it("reads the current process count after a fresh browser measurement", () => {
    let current = 361;
    const measured = new Map([["large", BROWSER_TASKS * 2], ["starting", BROWSER_TASKS]]);
    const budget = new ProcessBudget({ read: () => ({ max: 650, current }), browserTasks: (sessions) => {
      if (sessions.includes("starting")) current = 530;
      return sessions.reduce((sum, session) => sum + (measured.get(session) ?? 0), 0);
    }, log: () => {} });
    budget.browserRoom(() => true);
    budget.reserveBrowser("large");
    budget.reserveBrowser("starting");
    expect(budget.short(BROWSER_TASKS, 0)).toBe(true);
  });
});
