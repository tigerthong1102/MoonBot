import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHistogram } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { writeFileAtomic } from "../atomic.ts";
import { createLoopStalls, markRequestArrival, requestArrivedBefore, stallStats, timeBlocking } from "./loop-stalls.ts";
import { PERF_HEALTH_MAX_BYTES, perfHealth, stallLines } from "./perf-report.ts";

const tally = { n: 0, ms: 0, maxMs: 0 };
const minute = (count: number, points: Array<[number, number]>) => ({ count, points, maxMs: points.at(-1)![1], saves: tally, runtimeReads: tally });

describe("loop stall percentiles", () => {
  it("weighs each minute by its samples, so one bad minute shows in the hour's tail and not its middle", () => {
    const quiet = minute(3000, [[0, 0.1], [60, 0.2], [99, 0.5], [100, 1]]);
    const bad = minute(30, [[0, 0.1], [50, 0.3], [90, 900], [100, 2500]]);
    const hour = stallStats([quiet, quiet, bad])!;
    expect(hour.p50).toBe(0.2);
    expect(hour.max).toBe(2500);
    expect(hour.over1s).toBe(3);
    expect(hour.over100ms).toBe(15);
    expect(stallStats([bad])).toMatchObject({ p50: 0.3, p95: 2500, p99: 2500, max: 2500 });
    expect(stallStats([])).toBeNull();
  });
});

describe("the loop stall recorder", () => {
  it("retains exact sample ranks between sparse native histogram percentiles and across rolls", () => {
    const histogram = createHistogram();
    for (let i = 0; i < 96; i++) histogram.record(20_000_000);
    for (let i = 0; i < 4; i++) histogram.record(2_000_000_000);
    const stalls = createLoopStalls({ histogram });
    expect(stalls.report().m1).toMatchObject({ p95: 0, over100ms: 4, over1s: 4 });
    stalls.roll();
    for (let i = 0; i < 100; i++) histogram.record(20_000_000);
    expect(stalls.report().h1).toMatchObject({ p95: 0, over100ms: 4, over1s: 4 });
  });

  it.each([1, 3, 11, 21, 101])("matches native percentile ranks for %s samples and merged minutes", (count) => {
    const histogram = createHistogram();
    const merged = createHistogram();
    for (let i = 1; i < count; i++) { histogram.record(20_000_000); merged.record(20_000_000); }
    histogram.record(2_000_000_000);
    merged.record(2_000_000_000);
    const expected = (source: typeof histogram) => Object.fromEntries([50, 95, 99].map((p) => [`p${p}`, Math.max(0, Math.round(source.percentile(p) / 100_000) / 10 - 20)]));
    const stalls = createLoopStalls({ histogram });
    expect(stalls.report().m1).toMatchObject(expected(histogram));
    stalls.roll();
    for (let i = 0; i < 10; i++) { histogram.record(20_000_000); merged.record(20_000_000); }
    expect(stalls.report().h1).toMatchObject(expected(merged));
  });

  it("counts delays over a threshold before rounding their displayed milliseconds", () => {
    const histogram = createHistogram({ figures: 5 });
    histogram.record(120_001_000);
    histogram.record(1_020_001_000);
    const stalls = createLoopStalls({ histogram });
    expect(stalls.report().m1).toMatchObject({ over100ms: 2, over1s: 1, max: 1000 });
  });

  it("sees a stall the once-a-minute sampler would miss, and counts whole-file saves", async () => {
    const stalls = createLoopStalls({ minuteMs: 60_000 });
    const dir = mkdtempSync(join(tmpdir(), "loop-stalls-"));
    stalls.start();
    try {
      await delay(60);
      const before = stalls.report().saves.m1.n;
      writeFileAtomic(join(dir, "a.json"), "{}");
      timeBlocking("runtimeReads", () => { const until = Date.now() + 300; while (Date.now() < until) { } });
      await delay(60);
      const report = stalls.report();
      expect(report.m1!.max).toBeGreaterThanOrEqual(250);
      expect(report.m1!.over100ms).toBeGreaterThanOrEqual(1);
      expect(report.m1!.p50).toBeLessThan(report.m1!.max);
      expect(report.h1!.max).toBe(report.m1!.max);
      expect(report.saves.m1.n).toBe(before + 1);
      expect(report.runtimeReads.m1).toMatchObject({ n: 1 });
      expect(report.runtimeReads.m1.maxMs).toBeGreaterThanOrEqual(290);
      stalls.roll();
      const rolled = stalls.report();
      expect(rolled.m1!.max).toBe(report.m1!.max);
      expect(rolled.runtimeReads.h1.n).toBe(1);
      expect(stallLines(rolled)[0]).toMatch(/^Event loop stalls, measured all the time: last minute p50 .* max \d/);
    } finally {
      stalls.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts a message's wait when its request arrived, only for that request and only if recent", async () => {
    expect(requestArrivedBefore(Date.now())).toBeUndefined();
    await (async () => {
      markRequestArrival(1_000);
      await Promise.resolve();
      expect(requestArrivedBefore(3_500)).toBe(1_000);
      expect(requestArrivedBefore(500)).toBeUndefined();
      expect(requestArrivedBefore(1_000 + 120_000)).toBeUndefined();
    })();
  });

  it("fits the health report's budget with the rest of the timings, and holds numbers only", () => {
    const stalls = createLoopStalls();
    const report = stalls.report();
    const body = perfHealth({ hour: { turns: 0, failed: 0, phases: {}, slow: [], partial: false }, day: { turns: 0, failed: 0, slow: [], phases: {}, tools: [], retries: { n: 0, turns: 0, backoffMs: 0, why: {} }, limits: {}, failovers: 0 } as never,
      live: [], limits: null, process: null, stalls: report });
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(PERF_HEALTH_MAX_BYTES);
    expect(body.stalls).toEqual(report);
    const strings: string[] = [];
    JSON.stringify(report, (_key, value) => { if (typeof value === "string") strings.push(value); return value; });
    expect(strings).toEqual([]);
  });
});
