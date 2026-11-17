import { statfsSync } from "node:fs";

/** Docker defaults /dev/shm to 64 MB; Chrome tabs can crash when images or video exhaust it (crbug.com/736452). */
const ROOMY_BYTES = 512 * 1024 * 1024;

type Statfs = (path: string) => { blocks: number | bigint; bsize: number | bigint };

/** True where Chrome should keep its shared memory out of /dev/shm (--disable-dev-shm-usage puts it in /tmp). */
export function devShmIsSmall(platform: NodeJS.Platform = process.platform, statfs: Statfs = statfsSync): boolean {
  if (platform !== "linux") return false;
  try {
    const stats = statfs("/dev/shm");
    return Number(stats.blocks) * Number(stats.bsize) < ROOMY_BYTES;
  } catch {
    return true;
  }
}
