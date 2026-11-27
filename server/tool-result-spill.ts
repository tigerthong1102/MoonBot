import { createHash } from "node:crypto";
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "./store.ts";
import { writeFileAtomic } from "./atomic.ts";

function spillPath(dir: string, key: string): string {
  return join(dir, `${createHash("sha256").update(key).digest("hex")}.txt`);
}

function threadSpillDir(root: string, threadId: string) {
  const dir = threadId.replace(/[^\w.-]/g, "_");
  return dir && dir !== "." && dir !== ".." ? join(root, dir) : undefined;
}

export function readSpilledToolResult(root: string, threadId: string, turnId: string, itemId: string): string | undefined {
  const threadDir = threadSpillDir(root, threadId);
  if (!threadDir) return undefined;
  try {
    return readFileSync(spillPath(threadDir, `${threadId}:${turnId}:${itemId}`), "utf8");
  } catch { return undefined; }
}

/** Writes a hook's tool result, cut at `max` characters, to a private file; true when it fit whole. */
export function spillToolResult(dir: string, key: string, text: string, max: number): boolean {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const bounded = text.length > max ? `${text.slice(0, max)}\n[… ${text.length - max} more characters omitted]` : text;
  writeFileAtomic(spillPath(dir, key), bounded, { mode: 0o600 });
  return text.length <= max;
}

/** Retained hook evidence belongs to the new fork as well, including after its source is removed. */
export function copyForkToolResults(root: string, sourceId: string, targetId: string, history: Message[]) {
  const sourceDir = threadSpillDir(root, sourceId);
  const targetDir = threadSpillDir(root, targetId);
  if (!targetDir || targetDir === sourceDir) throw new Error("Invalid fork evidence folder");
  let created = false;
  const copied = new Set<string>();
  const rollback = () => { if (created) rmSync(targetDir, { recursive: true, force: true }); };
  try {
    for (const message of history) {
      const tool = message.tool;
      if (message.kind !== "activity" || !tool || tool.fullResult === undefined) continue;
      const key = `${message.turnId}:${tool.itemId}`;
      const source = sourceDir && spillPath(sourceDir, `${sourceId}:${key}`);
      if (!source || !message.turnId || !tool.itemId || tool.whose || tool.setup || !lstatSync(source, { throwIfNoEntry: false })?.isFile()) {
        delete tool.fullResult;
        continue;
      }
      if (copied.has(key)) continue;
      if (!created) { mkdirSync(targetDir, { mode: 0o700 }); created = true; }
      copyFileSync(source, spillPath(targetDir, `${targetId}:${key}`), constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      copied.add(key);
    }
    return rollback;
  } catch (error) { rollback(); throw error; }
}
