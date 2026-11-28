import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  let pids: string[] = [];
  let restricted = false;
  try {
    const proc = readFileSync("/proc/mounts", "utf8").split("\n").findLast(line => line.split(" ")[1] === "/proc");
    restricted = !proc || proc.split(" ")[3]!.split(",").some(option => option.startsWith("hidepid=") && !["hidepid=0", "hidepid=off"].includes(option));
    pids = readdirSync("/proc");
  } catch {
    restricted = true;
  }
  for (const pid of pids.filter(name => /^\d+$/.test(name))) {
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
      if (code === "EACCES" || code === "EPERM") {
        restricted = true;
        continue;
      }
      throw new Error("Cannot inspect SQLite holders before restore.", { cause: error });
    }
  }
  if (!holders.length && restricted) checkLinuxFileLeases(files);
  return holders;
}

// Linux F_SETLEASE(F_WRLCK) requires the target to have no other open file descriptions, including in processes hidden by procfs.
const linuxLeaseProbe = `
import errno, fcntl, os, stat, sys
for path in sys.argv[1:]:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                sys.exit(3)
            fcntl.fcntl(fd, fcntl.F_SETLEASE, fcntl.F_WRLCK)
        finally:
            os.close(fd)
    except OSError as error:
        sys.exit(2 if error.errno == errno.EAGAIN else 3)
`;

function checkLinuxFileLeases(files: readonly string[]) {
  const python = existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3";
  const probe = spawnSync(python, ["-I", "-S", "-c", linuxLeaseProbe, ...files], { timeout: 10_000 });
  if (probe.status === 2) throw new Error("Another process has a workspace SQLite file open. Close it before restoring.");
  if (probe.status !== 0) throw new Error("Cannot confirm SQLite files are idle: process inspection is restricted and a Linux file lease could not be acquired. Check Python 3, file ownership and filesystem lease support before restoring.");
}

const windowsProbe = `
$ErrorActionPreference = 'Stop'
$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
foreach ($file in $paths.Split([char]0)) {
  try { $handle = [IO.File]::Open($file, 'Open', 'Read', 'None'); $handle.Dispose() }
  catch [UnauthorizedAccessException] { exit 3 }
  catch [IO.IOException] { exit 2 }
}
`;

export function assertWindowsRestoreProbe(probe: { status: number | null; error?: NodeJS.ErrnoException; signal?: string | null }) {
  if (probe.status === 2 && !probe.error) throw new Error("Another process has a workspace SQLite file open. Close it before restoring.");
  if (probe.status !== 0 || probe.error) {
    const code = probe.error?.code;
    const detail = code && /^E[A-Z0-9]+$/.test(code) ? code : probe.signal ? "signal" : `exit ${probe.status ?? "unknown"}`;
    throw new Error(`Cannot access SQLite files for the restore preflight (${detail}).`);
  }
}

export function assertRestoreDatabasesIdle(root: string, names: readonly string[]) {
  const files = filesAt(root, names);
  if (!files.length) return;
  if (process.platform === "win32") {
    const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const probe = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", windowsProbe], {
      windowsHide: true, timeout: 10_000, input: Buffer.from(files.join("\0"), "utf8").toString("base64"),
    });
    assertWindowsRestoreProbe(probe);
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
