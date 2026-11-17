// Linux cgroup limits may be unavailable on other platforms or inside restricted sandboxes.
import { readFileSync, readdirSync, statfsSync } from "node:fs";

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
function pidsFiles(read: Read): string[] {
  const own = read("/proc/self/cgroup") ?? "";
  const v2 = /^0::(\/.*)$/m.exec(own)?.[1], v1 = /^\d+:(?:[^:]*,)?pids(?:,[^:]*)?:(\/.*)$/m.exec(own)?.[1];
  const dirs = ["/sys/fs/cgroup", "/sys/fs/cgroup/pids"];
  if (v2 && v2 !== "/") dirs.unshift(`/sys/fs/cgroup${v2}`);
  if (v1 && v1 !== "/") dirs.unshift(`/sys/fs/cgroup/pids${v1}`);
  return dirs;
}

export interface CgroupMemory { limitBytes: number; usedBytes: number; oomKills: number | null; fullStall10: number | null }

export function readCgroupMemory(read: Read = readText): CgroupMemory | null {
  const own = read("/proc/self/cgroup") ?? "";
  const v2 = /^0::(\/.*)$/m.exec(own)?.[1], v1 = /^\d+:(?:[^:]*,)?memory(?:,[^:]*)?:(\/.*)$/m.exec(own)?.[1];
  const number = (text: string | null, pattern: RegExp) => { const found = text === null ? null : pattern.exec(text); return found ? Number(found[1]) : null; };
  for (const dir of [...(v2 && v2 !== "/" ? [`/sys/fs/cgroup${v2}`] : []), "/sys/fs/cgroup"]) {
    const limit = count(read(`${dir}/memory.max`)), used = count(read(`${dir}/memory.current`));
    if (typeof limit !== "number" || typeof used !== "number") continue;
    const droppable = number(read(`${dir}/memory.stat`), /^inactive_file (\d+)$/m) ?? 0;
    return { limitBytes: limit, usedBytes: Math.max(0, used - droppable), oomKills: number(read(`${dir}/memory.events`), /^oom_kill (\d+)$/m),
      fullStall10: number(read(`${dir}/memory.pressure`), /^full avg10=([\d.]+)/m) };
  }
  for (const dir of [...(v1 && v1 !== "/" ? [`/sys/fs/cgroup/memory${v1}`] : []), "/sys/fs/cgroup/memory"]) {
    const limit = count(read(`${dir}/memory.limit_in_bytes`)), used = count(read(`${dir}/memory.usage_in_bytes`));
    if (typeof limit !== "number" || typeof used !== "number" || limit >= 2 ** 60) continue;
    const droppable = number(read(`${dir}/memory.stat`), /^total_inactive_file (\d+)$/m) ?? 0;
    return { limitBytes: limit, usedBytes: Math.max(0, used - droppable), oomKills: number(read(`${dir}/memory.oom_control`), /^oom_kill (\d+)$/m), fullStall10: null };
  }
  return null;
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
  for (const dir of pidsFiles(read)) {
    const current = count(read(`${dir}/pids.current`));
    if (typeof current !== "number") continue;
    return { max: count(read(`${dir}/pids.max`)), current };
  }
  return { max: null, current: null };
}

/** The kernel's own high-water marks for this cgroup since it was made (cgroup v2: pids.peak, memory.peak); null where
 * the kernel keeps none. */
export function readCgroupPeaks(read: Read = readText): { pids: number | null; memoryBytes: number | null } {
  const peak = (file: string) => {
    for (const dir of pidsFiles(read)) { const value = count(read(`${dir}/${file}`)); if (typeof value === "number") return value; }
    return null;
  };
  return { pids: peak("pids.peak"), memoryBytes: peak("memory.peak") };
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
