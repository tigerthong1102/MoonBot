import { createHash } from "node:crypto";
import { z } from "zod";
import type { TwinLearningRow } from "./ai-twin-learning.ts";

const scope = z.string().min(1).max(128).regex(/^[\w-]+$/);
export const twinExampleSource = z.strictObject({
  thread: scope, message: scope, parent: scope.optional(), digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TwinExampleSource = z.infer<typeof twinExampleSource>;
export type CheckTwinSources = (sources: readonly TwinExampleSource[]) => ReadonlySet<string>;

export function twinSourceIndex(rows: readonly TwinLearningRow[]) {
  const index = new Map(rows.map(row => [row.thread + ":" + row.message, row]));
  return (thread: string, message: string): TwinExampleSource | undefined => {
    const row = index.get(thread + ":" + message);
    if (!row) return;
    const parent = row.replyToId && index.get(thread + ":" + row.replyToId);
    const digest = createHash("sha256").update(JSON.stringify([
      thread, message, row.ts, row.text, row.replyToId ?? null, parent ? [parent.ts, parent.text] : null,
    ])).digest("hex");
    return { thread, message, ...(row.replyToId ? { parent: row.replyToId } : {}), digest };
  };
}
