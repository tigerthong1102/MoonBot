import type { ExecResult } from "./runner.ts";

type WaitForApproval = (request: () => Promise<ExecResult>) => Promise<ExecResult>;

export async function timed(ms: number, outer: AbortSignal | undefined,
  run: (signal: AbortSignal, waitForApproval: WaitForApproval) => Promise<ExecResult>): Promise<ExecResult | "timeout"> {
  const stopped = { ok: false as const, error: "The owning turn was stopped." };
  if (outer?.aborted) return stopped;
  const controller = new AbortController();
  let interrupt!: (result: ExecResult | "timeout") => void;
  const interrupted = new Promise<ExecResult | "timeout">(done => { interrupt = done; });
  const expire = () => { interrupt("timeout"); controller.abort(); };
  const stop = () => { interrupt(stopped); controller.abort(); };
  let remaining = ms;
  let activeSince = 0;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    activeSince = performance.now();
    timer = setTimeout(expire, remaining);
  };
  const waitForApproval: WaitForApproval = async request => {
    clearTimeout(timer);
    remaining -= Math.max(0, performance.now() - activeSince);
    if (remaining <= 0) { expire(); return stopped; }
    try { return await request(); }
    finally { if (!controller.signal.aborted) arm(); }
  };
  outer?.addEventListener("abort", stop, { once: true });
  arm();
  try {
    return await Promise.race([interrupted, run(controller.signal, waitForApproval)]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer!);
    outer?.removeEventListener("abort", stop);
  }
}
