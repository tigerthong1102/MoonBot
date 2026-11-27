import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function filesAt(root: string, names: readonly string[]) {
  const files: string[] = [];
  for (const name of names) {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const file = join(root, name + suffix);
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("The restore destination contains an unsafe SQLite file: " + name + suffix);
      files.push(file);
    }
  }
  return files;
}

function linuxHolders(files: readonly string[]) {
  const inode = (path: string) => {
    const stat = statSync(path, { bigint: true });
    return stat.dev + "/" + stat.ino;
  };
  const identities = new Set(files.map(inode));
  const holders: number[] = [];
  for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    const folder = join("/proc", pid, "fd");
    try {
      for (const fd of readdirSync(folder)) {
        try { if (!identities.has(inode(join(folder, fd)))) continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        holders.push(Number(pid));
        break;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ESRCH") continue;
      if (code === "EACCES" && statSync(join("/proc", pid), { throwIfNoEntry: false })?.uid !== process.getuid?.()) continue;
      throw new Error("Cannot inspect SQLite holders before restore.", { cause: error });
    }
  }
  return holders;
}

const windowsProbe = `
$ErrorActionPreference = 'Stop'
foreach ($file in (ConvertFrom-Json $env:STARTUPBOT_RESTORE_PATHS)) {
  try { $handle = [IO.File]::Open($file, 'Open', 'Read', 'None'); $handle.Dispose() }
  catch [UnauthorizedAccessException] { exit 3 }
  catch [IO.IOException] { exit 2 }
}
`;

export function assertRestoreDatabasesIdle(root: string, names: readonly string[]) {
  const files = filesAt(root, names);
  if (!files.length) return;
  if (process.platform === "win32") {
    const probe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsProbe], {
      windowsHide: true, timeout: 10_000, env: { ...process.env, STARTUPBOT_RESTORE_PATHS: JSON.stringify(files) },
    });
    if (probe.status === 2) throw new Error("Another process has a workspace SQLite file open. Close it before restoring.");
    if (probe.status !== 0) throw new Error("Cannot access SQLite files for the restore preflight.");
    return;
  }
  let holders: number[];
  if (process.platform === "linux") holders = linuxHolders(files);
  else {
    const probe = spawnSync("/usr/sbin/lsof", ["-nP", "-t", "--", ...files], { encoding: "utf8", timeout: 10_000 });
    if (probe.error || (probe.status !== 0 && (probe.status !== 1 || probe.stderr.trim()))) {
      throw new Error("Cannot inspect SQLite holders before restore.");
    }
    holders = [...new Set(probe.stdout.split(/\s+/).filter(pid => /^\d+$/.test(pid)).map(Number))];
  }
  if (holders.length) throw new Error("Workspace SQLite files are still open by PID " + holders.join(", ") + ". Close these processes and restart to restore.");
}
