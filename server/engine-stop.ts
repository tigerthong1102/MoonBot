import type { ChildProcess } from "node:child_process";
import { killCliTree, waitForExit } from "./procs.ts";

/** How long an engine gets to leave on its own after its input ends, and after SIGTERM, before it is killed. */
export const ENGINE_EOF_GRACE_MS = 500;
export const ENGINE_TERM_GRACE_MS = 1_500;

export async function stopEngineTree(child: ChildProcess, eofGraceMs = ENGINE_EOF_GRACE_MS, termGraceMs = ENGINE_TERM_GRACE_MS): Promise<boolean> {
  try { child.stdin?.end(); } catch {}
  if (eofGraceMs > 0) await waitForExit(child, eofGraceMs);
  return killCliTree(child, termGraceMs).catch(() => false);
}

export async function stopEngineTrees(children: Iterable<ChildProcess>, eofGraceMs?: number): Promise<boolean> {
  const results = await Promise.all([...new Set(children)].map((child) => stopEngineTree(child, eofGraceMs)));
  return results.every(Boolean);
}
