// POSIX signals to a child PID do not reach its descendants; signaling its process group does.
// Windows taskkill /T stops a process tree.
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { GROUP_SUPERVISOR } from "./group-exec-supervisor.ts";
import { processGroupMembers } from "./process-group.ts";

const supervisedGroups = new WeakSet<ChildProcess>();

export const OWN_GROUP = { windowsHide: true, detached: process.platform !== "win32" } as const;

const KILL_GRACE_MS = 2_000;

function groupSignal(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch { return false; }
}

/** Never signal a process group whose original identity can no longer be verified. */
export function stopGroup(child: ChildProcess, graceMs = KILL_GRACE_MS, allowExitedLeader = false): void {
  if (supervisedGroups.has(child)) {
    if (child.exitCode === null && child.signalCode == null) {
      if (child.connected) child.send({ stop: graceMs }, () => {});
      else child.kill("SIGTERM");
    }
    return;
  }
  const pid = child.pid;
  const exited = child.exitCode !== null || child.signalCode != null;
  const streamsClosed = [child.stdout, child.stderr].every(stream => !stream || stream.closed || stream.destroyed);
  if (exited && (!allowExitedLeader || streamsClosed)) return;
  if (pid && process.platform === "win32") {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  const members = pid ? processGroupMembers(pid) : new Map<number, string>();
  if (!pid || !groupSignal(pid, "SIGTERM")) {
    try { child.kill("SIGTERM"); } catch {}
    return;
  }
  const hard = setTimeout(() => {
    const current = processGroupMembers(pid);
    if ([...members].some(([member, start]) => current.get(member) === start)) groupSignal(pid, "SIGKILL");
  }, graceMs);
  hard.unref?.();
}

type ExecError = Error & { code?: number | string | null; signal?: NodeJS.Signals | null; killed?: boolean; cmd?: string; stdout?: string; stderr?: string };
type GroupExecOptions = Pick<SpawnOptions, "cwd" | "env" | "uid" | "gid"> & { timeout?: number; maxBuffer?: number; signal?: AbortSignal; encoding?: "utf8"; input?: never };

export function execFileInGroup(
  file: string,
  args: readonly string[],
  options: GroupExecOptions,
  callback: (error: ExecError | null, stdout: string, stderr: string) => void,
): ChildProcess {
  const { timeout, signal, maxBuffer = 1024 * 1024, encoding: _encoding, ...rest } = options;
  const cmd = [file, ...args].join(" ");
  let stdout = "", stderr = "", stopped = false, overflow = false, finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopGroup(child, KILL_GRACE_MS, process.platform !== "win32");
  };
  const finish = (error: ExecError | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    callback(error ? Object.assign(error, { cmd, stdout, stderr, ...(stopped ? { killed: true } : {}) }) : null, stdout, stderr);
  };
  const child = process.platform === "win32"
    ? spawn(file, args, { ...rest, ...OWN_GROUP, stdio: ["pipe", "pipe", "pipe"] })
    : spawn(process.execPath, ["-e", GROUP_SUPERVISOR, rest.env?.ELECTRON_RUN_AS_NODE ?? (rest.env ? "unset" : process.env.ELECTRON_RUN_AS_NODE ?? "unset"), file, ...args], {
      ...rest, ...OWN_GROUP, env: { ...(rest.env ?? process.env), ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
  if (process.platform !== "win32") {
    supervisedGroups.add(child);
    child.on("message", (message: unknown) => {
      const error = (message as { spawnError?: { message: string; code?: string } } | null)?.spawnError;
      if (error) child.emit("error", Object.assign(new Error(error.message), error));
    });
  }
  let retainedBytes = 0;
  const take = (which: "stdout" | "stderr") => (chunk: string) => {
    const bytes = Buffer.from(chunk);
    const available = Math.max(0, maxBuffer - retainedBytes);
    const retained = bytes.subarray(0, available).toString("utf8");
    if (which === "stdout") stdout += retained; else stderr += retained;
    retainedBytes += Math.min(bytes.length, available);
    if (!overflow && bytes.length > available) { overflow = true; stop(); }
  };
  child.stdout!.setEncoding("utf8").on("data", take("stdout"));
  child.stderr!.setEncoding("utf8").on("data", take("stderr"));
  // A child that exits before reading its input must not surface as an unhandled EPIPE.
  child.stdin!.on("error", () => {});
  child.once("error", (error) => finish(error));
  child.once("close", (code, exitSignal) => {
    if (overflow) return finish(Object.assign(new RangeError(`${file} wrote more than ${maxBuffer} bytes`), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));
    if (code === 0 && !exitSignal && !stopped) return finish(null);
    finish(Object.assign(new Error(`Command failed: ${cmd}\n${stderr}`), { code, signal: exitSignal }));
  });
  if (timeout) {
    timer = setTimeout(stop, timeout);
    timer.unref?.();
  }
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return child;
}

export function execFileInGroupAsync(file: string, args: readonly string[], options: GroupExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileInGroup(file, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}
