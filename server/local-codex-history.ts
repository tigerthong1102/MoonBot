// Session metadata normalization adapted from stablyai/orca, MIT, Copyright (c) 2026 Lovecast Inc.
// src/main/codex/history/rollouts/codex-rollout-session-meta.ts. See public/licenses/orca.txt.
import { constants, closeSync, fstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";

const ROLLOUT_READ_LIMIT = 64 * 1024;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
interface Rollout { id: string; cwd: string; branch: string; file: string }

export function readRollout(file: string): Rollout | null {
  if (!/^rollout-.*\.jsonl$/.test(basename(file))) return null;
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(fd).isFile()) return null;
    const head = Buffer.alloc(ROLLOUT_READ_LIMIT);
    const n = readSync(fd, head, 0, head.length, 0);
    const firstLine = head.subarray(0, n).toString("utf8").split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine) return null;
    const record = JSON.parse(firstLine);
    if (record?.type !== "session_meta") return null;
    const id = record.payload?.id ?? record.payload?.session_id ?? record.payload?.thread_id ??
      record.id ?? record.session_id ?? record.thread_id;
    if (typeof id !== "string" || !uuid.test(id)) return null;
    return { id, cwd: typeof record.payload?.cwd === "string" ? record.payload.cwd : "",
      branch: typeof record.payload?.git?.branch === "string" ? record.payload.git.branch : "", file };
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Scan only the chosen directory and ordinary children; keep no index or prompt bodies. */
export function searchRollouts(directory: string, query = "") {
  const pending = [realpathSync(directory)];
  const byId = new Map<string, Rollout>();
  const needle = query.toLowerCase();
  const result = (truncated: boolean) => ({
    results: [...byId.values()].filter(row => [row.id, row.cwd, row.branch].some(value => value.toLowerCase().includes(needle))),
    truncated,
  });
  let visited = 0;
  while (pending.length) {
    const folder = pending.pop()!;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 20_000) return result(true);
      const file = join(folder, entry.name);
      if (entry.isDirectory()) { pending.push(file); continue; }
      if (!entry.isFile()) continue;
      const row = readRollout(file);
      if (row) {
        const previous = byId.get(row.id);
        // Native rollout names sort by their timestamp, including rewound copies of the same conversation.
        if (!previous || basename(row.file) > basename(previous.file)) byId.set(row.id, row);
      }
    }
  }
  return result(false);
}

export function localFork(file: string, codexHome: string, dataDir: string, threadId?: string, instance = "codex") {
  const resolved = realpathSync(file);
  const within = relative(realpathSync(join(codexHome, "sessions")), resolved);
  if (!within || within === ".." || within.startsWith(".." + sep) || isAbsolute(within)) throw new Error("Choose a rollout in the current Codex account's sessions folder.");
  const row = readRollout(resolved);
  if (!row || !isAbsolute(row.cwd) || realpathSync(row.cwd) !== realpathSync(process.cwd())) throw new Error("Open the original working directory before forking this session.");
  if (threadId) {
    const bots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8")) as Array<{ tasks?: { threadId: string; resumeCursors?: Record<string, unknown> }[]; threadId: string; resumeCursors?: Record<string, unknown> }>;
    const owner = bots.find(bot => bot.threadId === threadId || bot.tasks?.some(task => task.threadId === threadId));
    const cursor = owner?.tasks?.find(task => task.threadId === threadId)?.resumeCursors?.[instance] ?? (owner?.threadId === threadId ? owner.resumeCursors?.[instance] : undefined);
    if (cursor !== row.id) throw new Error("The selected StartupBot thread and engine instance do not own this session.");
  }
  return row;
}
