import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay, performance, type Histogram, type IntervalHistogram } from "node:perf_hooks";

export type BlockingKind = "saves" | "runtimeReads";
export interface Tally { n: number; ms: number; maxMs: number }
const zero = (): Tally => ({ n: 0, ms: 0, maxMs: 0 });

let current: Record<BlockingKind, Tally> = { saves: zero(), runtimeReads: zero() };

export function noteBlocking(kind: BlockingKind, ms: number): void {
  const tally = current[kind];
  tally.n += 1;
  tally.ms += ms;
  if (ms > tally.maxMs) tally.maxMs = ms;
}

export function timeBlocking<T>(kind: BlockingKind, run: () => T): T {
  const at = performance.now();
  try {
    return run();
  } finally {
    noteBlocking(kind, performance.now() - at);
  }
}

const arrival = new AsyncLocalStorage<number>();
export const markRequestArrival = (at = Date.now()): void => arrival.enterWith(at);
export function requestArrivedBefore(at: number, withinMs = 60_000): number | undefined {
  const arrived = arrival.getStore();
  return arrived !== undefined && arrived <= at && at - arrived <= withinMs ? arrived : undefined;
}

interface Minute { count: number; points: Array<[number, number]>; maxMs: number; saves: Tally; runtimeReads: Tally }

export interface StallStats { p50: number; p95: number; p99: number; max: number; over100ms: number; over1s: number }
export interface StallsReport {
  m1: StallStats | null;
  h1: StallStats | null;
  saves: { m1: Tally; h1: Tally };
  runtimeReads: { m1: Tally; h1: Tally };
}

const lateMs = (ns: number, resolutionMs: number) => Math.max(0, ns / 1e6 - resolutionMs);

function minuteOf(histogram: Pick<IntervalHistogram, "count" | "max" | "percentile">, tallies: Record<BlockingKind, Tally>, resolutionMs: number): Minute {
  const ranks = new Map<number, number>();
  for (let rank = 1; rank <= histogram.count; rank++) {
    const percentile = rank / histogram.count * 100;
    ranks.set(lateMs(histogram.percentile(percentile), resolutionMs), percentile);
  }
  const points = [...ranks].map(([delay, percentile]) => [percentile, delay] as [number, number]);
  return { count: histogram.count, points, maxMs: histogram.count ? lateMs(histogram.max, resolutionMs) : 0, saves: { ...tallies.saves }, runtimeReads: { ...tallies.runtimeReads } };
}

function shareAtOrUnder(minute: Minute, value: number): number {
  let share = 0;
  for (const [percentile, delay] of minute.points) {
    if (delay > value) break;
    share = percentile / 100;
  }
  return share;
}

export function stallStats(minutes: readonly Minute[]): StallStats | null {
  const used = minutes.filter((minute) => minute.count > 0);
  const total = used.reduce((sum, minute) => sum + minute.count, 0);
  if (!total) return null;
  const values = [...new Set(used.flatMap((minute) => minute.points.map(([, delay]) => delay)))].sort((a, b) => a - b);
  const atOrUnder = (value: number) => used.reduce((sum, minute) => sum + Math.round(minute.count * shareAtOrUnder(minute, value)), 0);
  const quantile = (q: number) => {
    const rank = Math.max(1, Math.round(q * total));
    let low = 0, high = values.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (atOrUnder(values[mid]!) >= rank) high = mid; else low = mid + 1;
    }
    return values[low] ?? 0;
  };
  const over = (value: number) => total - atOrUnder(value);
  const display = (ms: number) => Math.round(ms * 10) / 10;
  return { p50: display(quantile(0.5)), p95: display(quantile(0.95)), p99: display(quantile(0.99)), max: display(Math.max(...used.map((minute) => minute.maxMs))), over100ms: over(100), over1s: over(1000) };
}

const sum = (tallies: readonly Tally[]): Tally => tallies.reduce((all, tally) => ({ n: all.n + tally.n, ms: all.ms + tally.ms, maxMs: Math.max(all.maxMs, tally.maxMs) }), zero());
const rounded = (tally: Tally): Tally => ({ n: tally.n, ms: Math.round(tally.ms), maxMs: Math.round(tally.maxMs * 10) / 10 });

export const STALL_RESOLUTION_MS = 20;
export const MINUTE_MS = 60_000;
const MINUTES_KEPT = 60;

export function createLoopStalls(options: { histogram?: Histogram & Partial<Pick<IntervalHistogram, "enable" | "disable">>; minuteMs?: number; resolutionMs?: number } = {}) {
  const resolutionMs = options.resolutionMs ?? STALL_RESOLUTION_MS;
  const histogram = options.histogram ?? monitorEventLoopDelay({ resolution: resolutionMs });
  const minuteMs = options.minuteMs ?? MINUTE_MS;
  const minutes: Minute[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const roll = () => {
    minutes.push(minuteOf(histogram, current, resolutionMs));
    if (minutes.length > MINUTES_KEPT) minutes.shift();
    histogram.reset();
    current = { saves: zero(), runtimeReads: zero() };
  };
  return {
    start() {
      if (timer) return;
      histogram.enable?.();
      timer = setInterval(roll, minuteMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      histogram.disable?.();
    },
    roll,
    report(): StallsReport {
      const live = minuteOf(histogram, current, resolutionMs);
      const last = minutes.at(-1);
      const m1 = last && last.count ? last : live;
      const hour = [...minutes.slice(-(MINUTES_KEPT - 1)), live];
      return {
        m1: stallStats([m1]), h1: stallStats(hour),
        saves: { m1: rounded(m1.saves), h1: rounded(sum(hour.map((minute) => minute.saves))) },
        runtimeReads: { m1: rounded(m1.runtimeReads), h1: rounded(sum(hour.map((minute) => minute.runtimeReads))) },
      };
    },
  };
}
export type LoopStalls = ReturnType<typeof createLoopStalls>;
