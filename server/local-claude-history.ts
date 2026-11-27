import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { readJsonObjectMembers } from "./session-header-members.ts";
import type { Rollout } from "./local-codex-history.ts";

const identity = /^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.jsonl$/i;
const wanted = new Set(["sessionId", "cwd", "gitBranch", "isSidechain"]);

export function readClaudeHeader(file: string): Rollout | null {
  const id = identity.exec(basename(file))?.[1];
  if (!id) return null;
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(fd).isFile()) return null;
    const bytes = Buffer.alloc(128 * 1024);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    for (const line of bytes.subarray(0, length).toString("utf8").split(/\r?\n/)) {
      const fields = readJsonObjectMembers(line, wanted);
      if (!fields || fields.get("isSidechain") === "true" || !fields.has("sessionId") || !fields.has("cwd")) continue;
      const native = JSON.parse(fields.get("sessionId")!);
      const cwd = JSON.parse(fields.get("cwd")!);
      const branch = JSON.parse(fields.get("gitBranch") ?? '""');
      if (native === id && typeof cwd === "string" && isAbsolute(cwd)) return { id, cwd, branch: typeof branch === "string" ? branch : "", file };
    }
    return null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function claudeFork(file: string, configDir: string) {
  const resolved = realpathSync(file);
  const within = relative(realpathSync(join(configDir, "projects")), resolved);
  const parts = within.split(sep);
  if (isAbsolute(within) || parts.length !== 2 || parts[0] === "..") throw new Error("Select a primary session from the active Claude account.");
  const row = readClaudeHeader(resolved);
  if (!row || realpathSync(row.cwd) !== realpathSync(process.cwd())) throw new Error("Open the recorded Claude project directory before forking.");
  return row;
}
