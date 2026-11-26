import { capStates, effectiveCaps, type UsageCapsConfig } from "./usage-caps.ts";
import { spendState } from "./spend.ts";
import type { AppConfig } from "./config.ts";

type Usage = { tokens: number; usd: number };
type Limits = Pick<AppConfig, "budgets"> & { usageCaps?: UsageCapsConfig };

/** Completed HTTP requests are visible here until the driver's normal turn-completed event
 * books the aggregate. Concurrent sibling turns therefore see one another's measured usage. */
export function createRequestBudgets(deps: {
  config(): Limits; directory: string; activeRoots(): Set<string>;
}) {
  const inflight = new Map<symbol, Usage & { bot: string }>();
  const runs = new Map<string, Usage>();
  const pendingRoots = new Set<() => Usage>();
  return (bot: string, waiting: boolean, root: () => { id: string; bot: string } | undefined) => {
    const ticket = Symbol();
    const local = { tokens: 0, usd: 0, bot };
    const localRun = { tokens: 0, usd: 0 };
    const fail = () => { throw Object.assign(new Error("The configured spending cap stopped this run before the next model request."), { code: "spend_cap" }); };
    let bound: string | undefined;
    const totals = () => {
      const current = root();
      if (!current) return bound ? runs.get(bound) ?? localRun : localRun;
      // A first delegation can create the coordinator root after its parent's first request.
      if (bound !== current.id) {
        const value = runs.get(current.id) ?? { tokens: 0, usd: 0 };
        value.tokens += localRun.tokens;
        value.usd += localRun.usd;
        localRun.tokens = localRun.usd = 0;
        runs.set(current.id, value);
        bound = current.id;
        pendingRoots.delete(totals);
      }
      return runs.get(current.id) ?? localRun;
    };
    return {
      before() {
        const cfg = deps.config();
        const caps = cfg.usageCaps;
        if (caps?.run) for (const resolve of pendingRoots) resolve();
        const run = caps?.run ? totals() : localRun;
        if ((caps?.run?.tokens && run.tokens >= caps.run.tokens) || (caps?.run?.usd && run.usd >= caps.run.usd)) fail();
        const pending = [...inflight.values()];
        const spent = spendState(cfg, deps.directory);
        if (spent && spent.spentUsd + pending.reduce((sum, item) => sum + item.usd, 0) >= spent.monthlyUsd) fail();
        if (waiting && effectiveCaps(caps, process.env).stops !== "everything") return;
        if (!caps?.bots && !Object.values(effectiveCaps(caps, process.env).server).some(value => value > 0)) return;
        for (const id of new Set([bot, root()?.bot ?? bot])) {
          for (const cap of capStates(caps, deps.directory, new Date(), process.env, id)) {
            const add = pending.reduce((sum, item) => sum + (cap.scope === "server" || item.bot === id ? item[cap.unit] : 0), 0);
            if (cap.used + add >= cap.limit) fail();
          }
        }
      },
      record(tokens: number, usd: number) {
        const run = deps.config().usageCaps?.run ? totals() : localRun;
        if (!bound && deps.config().usageCaps?.run) pendingRoots.add(totals);
        run.tokens += tokens; run.usd += usd;
        local.tokens += tokens; local.usd += usd;
        inflight.set(ticket, local);
      },
      finish() {
        if (pendingRoots.delete(totals)) totals();
        inflight.delete(ticket);
        if (runs.size) {
          const live = deps.activeRoots();
          for (const id of runs.keys()) if (!live.has(id)) runs.delete(id);
        }
      },
    };
  };
}
