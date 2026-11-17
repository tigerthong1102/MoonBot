// Linux cgroup limits may be unavailable on other platforms or inside restricted sandboxes.
import { readFileSync, readdirSync, statfsSync } from "node:fs";
import { posix } from "node:path";

export type Unknown = "unknown";

export interface ProcessLimits {
  /** The cgroup's pids.max: threads count against it as processes do. */
  pidsMax: number | "max" | Unknown;
  pidsCurrent: number | Unknown;
  /** RLIMIT_NPROC's soft value. */
  nproc: number | "unlimited" | Unknown;
  shmBytes: number | Unknown;
  pid1: "init" | "node" | "other" | Unknown;
  reaper: "yes" | "no" | Unknown;
}

type Read = (path: string) => string | null;
const readText: Read = (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } };

const INITS: ReadonlySet<string> = new Set(["tini", "dumb-init", "docker-init", "init", "systemd", "s6-svscan", "runit", "catatonit", "pause"]);
const NODE = new Set(["node", "mainthread"]);

const count = (text: string | null): number | "max" | null => {
  const value = text?.trim();
  if (!value) return null;
  if (value === "max") return "max";
  return /^\d+$/.test(value) ? Number(value) : null;
};

/** In a container with its own cgroup namespace, the cgroup path is "/", relative to its mount. */
function controllerDirectories(read: Read, controller: "pids" | "memory"): Array<{ path: string; version: 1 | 2 }> {
  const own = read("/proc/self/cgroup") ?? "";
  const v2 = /^0::(\/.*)$/m.exec(own)?.[1];
  const v1 = new RegExp(`^\\d+:(?:[^:]*,)?${controller}(?:,[^:]*)?:(/.*)$`, "m").exec(own)?.[1];
  const roots: Array<{ root: string; membership: string; version: 1 | 2 }> = [];
  if (v2) roots.push({ root: "/sys/fs/cgroup", membership: v2, version: 2 });
  if (v1) roots.push({ root: `/sys/fs/cgroup/${controller}`, membership: v1, version: 1 });
  if (!roots.length) roots.push({ root: "/sys/fs/cgroup", membership: "/", version: 2 }, { root: `/sys/fs/cgroup/${controller}`, membership: "/", version: 1 });
  const dirs: Array<{ path: string; version: 1 | 2 }> = [];
  for (const { root, membership, version } of roots) {
    const invalid = membership.split("/").some((part) => part === ".." || part === ".");
    for (let path = invalid ? root : posix.resolve(root, `.${membership}`); path === root || path.startsWith(`${root}/`); path = posix.dirname(path)) {
      dirs.push({ path, version });
      if (path === root) break;
    }
  }
  return dirs;
}

export interface CgroupMemory { limitBytes: number; usedBytes: number; oomKills: number | null; fullStall10: number | null }

export function readCgroupMemory(read: Read = readText): CgroupMemory | null {
  const number = (text: string | null, pattern: RegExp) => { const found = text === null ? null : pattern.exec(text); return found ? Number(found[1]) : null; };
  let tightest: Pick<CgroupMemory, "limitBytes" | "usedBytes"> | null = null;
  let ownEvents: Pick<CgroupMemory, "oomKills" | "fullStall10"> | undefined;
  for (const { path: dir, version } of controllerDirectories(read, "memory")) {
    const limit = count(read(`${dir}/${version === 2 ? "memory.max" : "memory.limit_in_bytes"}`));
    const used = count(read(`${dir}/${version === 2 ? "memory.current" : "memory.usage_in_bytes"}`));
    if (typeof used !== "number") continue;
    ownEvents ??= {
      oomKills: number(read(`${dir}/${version === 2 ? "memory.events" : "memory.oom_control"}`), /^oom_kill (\d+)$/m),
      fullStall10: version === 2 ? number(read(`${dir}/memory.pressure`), /^full avg10=([\d.]+)/m) : null,
    };
    if (typeof limit !== "number" || (version === 1 && limit >= 2 ** 60)) continue;
    const droppable = number(read(`${dir}/memory.stat`), version === 2 ? /^inactive_file (\d+)$/m : /^total_inactive_file (\d+)$/m) ?? 0;
    const usedBytes = Math.max(0, used - droppable);
    if (!tightest || limit - usedBytes < tightest.limitBytes - tightest.usedBytes) tightest = { limitBytes: limit, usedBytes };
  }
  return tightest ? { ...tightest, oomKills: ownEvents?.oomKills ?? null, fullStall10: ownEvents?.fullStall10 ?? null } : null;
}

/** A cgroup namespace can hide limits enforced by ancestors outside the container. */
export function containerLimited(read: Read = readText): boolean {
  if (typeof count(read("/sys/fs/cgroup/pids.max")) === "number" || typeof count(read("/sys/fs/cgroup/memory.max")) === "number") return true;
  if (typeof count(read("/sys/fs/cgroup/pids/pids.max")) === "number") return true;
  const v1 = count(read("/sys/fs/cgroup/memory/memory.limit_in_bytes"));
  return typeof v1 === "number" && v1 < 2 ** 60;
}

/** Cgroup limits enforced by hidden ancestors can remain active while the container sees "max". */
export function readPids(read: Read = readText): { max: number | "max" | null; current: number | null } {
  let best: { max: number | "max" | null; current: number | null } = { max: null, current: null };
  let remaining = Infinity;
  for (const { path: dir } of controllerDirectories(read, "pids")) {
    const current = count(read(`${dir}/pids.current`));
    if (typeof current !== "number") continue;
    const max = count(read(`${dir}/pids.max`));
    if (best.current === null) best = { max, current };
    if (typeof max === "number" && max - current < remaining) {
      best = { max, current };
      remaining = max - current;
    }
  }
  return best;
}

/** The kernel's own high-water marks for this cgroup since it was made (cgroup v2: pids.peak, memory.peak); null where
 * the kernel keeps none. */
export function readCgroupPeaks(read: Read = readText): { pids: number | null; memoryBytes: number | null } {
  const peak = (controller: "pids" | "memory", file: string) => {
    for (const { path: dir } of controllerDirectories(read, controller)) { const value = count(read(`${dir}/${file}`)); if (typeof value === "number") return value; }
    return null;
  };
  return { pids: peak("pids", "pids.peak"), memoryBytes: peak("memory", "memory.peak") };
}

function nproc(read: Read): ProcessLimits["nproc"] {
  const soft = /^Max processes\s+(\S+)/m.exec(read("/proc/self/limits") ?? "")?.[1];
  if (soft === undefined) return "unknown";
  return soft === "unlimited" ? "unlimited" : /^\d+$/.test(soft) ? Number(soft) : "unknown";
}

const comm = (read: Read, pid: number | string) => read(`/proc/${pid}/comm`)?.trim().toLowerCase() ?? null;

function parentOf(read: Read, pid: number): number | null {
  const stat = read(`/proc/${pid}/stat`);
  if (!stat) return null;
  const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  return Number.isInteger(parent) ? parent : null;
}

export interface LimitsOptions { platform?: NodeJS.Platform; read?: Read; pid?: number; shm?: () => number | null }

const shmBytes = (): number | null => {
  try { const stats = statfsSync("/dev/shm"); return Number(stats.blocks) * Number(stats.bsize); } catch { return null; }
};

export function readProcessLimits(options: LimitsOptions = {}): ProcessLimits {
  const unknown: ProcessLimits = { pidsMax: "unknown", pidsCurrent: "unknown", nproc: "unknown", shmBytes: "unknown", pid1: "unknown", reaper: "unknown" };
  if ((options.platform ?? process.platform) !== "linux") return unknown;
  const read = options.read ?? readText, pid = options.pid ?? process.pid;
  const pids = readPids(read), first = comm(read, 1);
  const pid1: ProcessLimits["pid1"] = first === null ? "unknown" : INITS.has(first) ? "init" : NODE.has(first) ? "node" : "other";
  let reaper: ProcessLimits["reaper"] = pid1 === "init" ? "yes" : pid1 === "node" ? "no" : "unknown";
  for (let at: number | null = pid, depth = 0; reaper !== "yes" && at !== null && at > 1 && depth < 8; at = parentOf(read, at), depth += 1) {
    const name = comm(read, at);
    if (name !== null && (name === "tini" || name === "dumb-init" || name === "catatonit")) reaper = "yes";
  }
  const shm = (options.shm ?? shmBytes)();
  return { pidsMax: pids.max ?? "unknown", pidsCurrent: pids.current ?? "unknown", nproc: nproc(read), shmBytes: shm ?? "unknown", pid1, reaper };
}

export function openDescriptors(list: (path: string) => string[] = readdirSync): number | Unknown {
  try { return list("/proc/self/fd").length; } catch { return "unknown"; }
}
