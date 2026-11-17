import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { execFileInGroup, execFileInGroupAsync, OWN_GROUP, stopGroup } from "./group-exec.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { processGroupMembers } from "./process-group.ts";

vi.mock("./process-group.ts", { spy: true });

const posix = process.platform !== "win32";
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await removeTempDir(folder); });

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** A shell that starts a background child (as git starts git-remote-https) and writes its pid. */
function script(): { file: string; args: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "omb-group-exec-"));
  folders.push(dir);
  return { file: "/bin/sh", args: ["-c", `sleep 30 & echo $! > "$0"; wait`, join(dir, "child.pid")] };
}
const childOf = async (path: string) => {
  await vi.waitFor(() => expect(existsSync(path) && readFileSync(path, "utf8").trim()).toBeTruthy());
  return Number(readFileSync(path, "utf8").trim());
};

describe.skipIf(!posix)("a child in a group of its own", () => {
  it("stops what it started too when its timeout passes, and reports the run killed", async () => {
    const { file, args } = script();
    const done = execFileInGroupAsync(file, args, { timeout: 300 });
    const child = await childOf(args[2]!);
    await expect(done).rejects.toMatchObject({ killed: true });
    await vi.waitFor(() => expect(alive(child)).toBe(false));
  });

  it("stops the whole group when its signal aborts", async () => {
    const { file, args } = script();
    const abort = new AbortController();
    const result = new Promise<{ killed?: boolean } | null>((resolve) => { execFileInGroup(file, args, { signal: abort.signal }, (error) => resolve(error)); });
    const child = await childOf(args[2]!);
    abort.abort();
    expect(await result).toMatchObject({ killed: true });
    await vi.waitFor(() => expect(alive(child)).toBe(false));
  });

  it("answers as execFile does when the command finishes", async () => {
    await expect(execFileInGroupAsync("/bin/sh", ["-c", "echo out; echo err >&2"])).resolves.toEqual({ stdout: "out\n", stderr: "err\n" });
    await expect(execFileInGroupAsync("/bin/sh", ["-c", "exit 3"])).rejects.toMatchObject({ code: 3 });
  });

  it("times out when the group leader exits before a descendant closes stdout", async () => {
    const result = execFileInGroupAsync("/bin/sh", ["-c", "sleep 30 & exit 0"], { timeout: 300 });
    await expect(result).rejects.toMatchObject({ killed: true });
  });

  it("does not retain output beyond maxBuffer while termination is pending", async () => {
    const script = 'process.on("SIGTERM", () => {}); setInterval(() => process.stdout.write("x".repeat(65536)), 1)';
    await expect(execFileInGroupAsync(process.execPath, ["-e", script], { maxBuffer: 1024 })).rejects.toMatchObject({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      stdout: "x".repeat(1024),
    });
  });

  it("hard-kills descendants that inherit pipes and ignore graceful termination", async () => {
    const result = execFileInGroupAsync("/bin/sh", ["-c", "trap '' TERM; sleep 30 & wait"], { timeout: 200 });
    await expect(result).rejects.toMatchObject({ killed: true });
  });

  it("does not signal a closed group's ID after its child exits", async () => {
    const shell = spawn("/bin/sh", ["-c", "sleep 30"], { stdio: ["ignore", "pipe", "pipe"], ...OWN_GROUP });
    const groupPid = shell.pid;
    if (!groupPid) throw new Error("the test command did not spawn");
    const signal = vi.spyOn(process, "kill");
    try {
      const closed = new Promise<void>(resolve => shell.once("close", () => resolve()));
      stopGroup(shell, 250);
      await closed;
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(signal.mock.calls.filter(args => args[0] === -groupPid && args[1] === "SIGKILL")).toHaveLength(0);
    } finally {
      signal.mockRestore();
    }
  });

  it("hard-kills a descendant with ignored stdio after the leader closes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-group-exec-"));
    folders.push(dir);
    const pidFile = join(dir, "child.pid");
    const descendant = 'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)';
    const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}, ${JSON.stringify(pidFile)}], { stdio: "ignore" }); setInterval(() => {}, 1000)`;
    const leader = spawn(process.execPath, ["-e", parent], { ...OWN_GROUP, stdio: "ignore" });
    let descendantPid: number | undefined;
    try {
      descendantPid = await childOf(pidFile);
      const closed = new Promise<void>(resolve => leader.once("close", () => resolve()));
      stopGroup(leader, 200);
      await closed;
      await vi.waitFor(() => expect(processGroupMembers(leader.pid!).has(descendantPid!)).toBe(false), { timeout: 2_000 });
    } finally {
      if (descendantPid) { try { process.kill(descendantPid, "SIGKILL"); } catch {} }
      try { process.kill(-leader.pid!, "SIGKILL"); } catch {}
    }
  });

  it("does not hard-kill a reused group whose member PID has a different start time", async () => {
    const leader = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { ...OWN_GROUP, stdio: "ignore" });
    const pid = leader.pid!;
    const members = vi.mocked(processGroupMembers);
    members.mockReturnValueOnce(new Map([[pid, "original"]])).mockReturnValueOnce(new Map([[pid, "replacement"]]));
    const signal = vi.spyOn(process, "kill");
    try {
      const closed = new Promise<void>(resolve => leader.once("close", () => resolve()));
      stopGroup(leader, 100);
      await closed;
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(signal.mock.calls.filter(args => args[0] === -pid && args[1] === "SIGKILL")).toHaveLength(0);
    } finally {
      signal.mockRestore();
      members.mockClear();
    }
  });

  it("stopGroup ends a spawned child's group, and does nothing once the child has exited", async () => {
    const { file, args } = script();
    const shell = spawn(file, args, { stdio: "ignore", ...OWN_GROUP });
    const child = await childOf(args[2]!);
    const exited = new Promise((resolve) => shell.once("exit", resolve));
    stopGroup(shell, 100);
    await exited;
    await vi.waitFor(() => expect(alive(child)).toBe(false));
    expect(() => stopGroup(shell)).not.toThrow();
  });
});
