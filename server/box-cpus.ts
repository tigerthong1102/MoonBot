import { availableParallelism } from "node:os";

/** Node 24 (libuv 1.52) counts cgroup cpu.max quotas and CPU affinity; os.cpus() reports the host CPU count. */
export function boxCpus(): number {
  return Math.max(1, availableParallelism());
}
