import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export function processGroupMembers(group: number): Map<number, string> {
  const members = new Map<number, string>();
  if (process.platform === "linux") {
    let names: string[];
    try { names = readdirSync("/proc"); } catch { return members; }
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(fields[2]) === group && fields[19] && fields[0] !== "Z" && fields[0] !== "X") members.set(Number(name), fields[19]);
      } catch {}
    }
    return members;
  }
  try {
    const rows = execFileSync("/bin/ps", ["-A", "-o", "pid=,pgid=,stat=,lstart="], {
      encoding: "utf8", timeout: 1_000, maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C" },
    });
    for (const row of rows.trim().split("\n")) {
      const [pid, pgid, state, ...start] = row.trim().split(/\s+/);
      if (Number(pgid) === group && start.length === 5 && !state?.startsWith("Z")) members.set(Number(pid), start.join(" "));
    }
  } catch {}
  return members;
}
