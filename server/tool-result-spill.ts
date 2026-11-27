import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";

function spillPath(dir: string, key: string): string {
  return join(dir, `${createHash("sha256").update(key).digest("hex")}.txt`);
}

export function readSpilledToolResult(root: string, threadId: string, turnId: string, itemId: string): string | undefined {
  const threadDir = threadId.replace(/[^\w.-]/g, "_");
  if (!threadDir || threadDir === "." || threadDir === "..") return undefined;
  try {
    return readFileSync(spillPath(join(root, threadDir), `${threadId}:${turnId}:${itemId}`), "utf8");
  } catch { return undefined; }
}

/** Writes a hook's tool result, cut at `max` characters, to a private file; true when it fit whole. */
export function spillToolResult(dir: string, key: string, text: string, max: number): boolean {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const bounded = text.length > max ? `${text.slice(0, max)}\n[… ${text.length - max} more characters omitted]` : text;
  writeFileAtomic(spillPath(dir, key), bounded, { mode: 0o600 });
  return text.length <= max;
}
