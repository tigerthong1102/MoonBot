import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "mcp-gate.ts");

const SERVER = `
const { writeFileSync } = require("node:fs");
if (process.env.SETUP_DELAY_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.SETUP_DELAY_MS));
process.stdin.resume();
if (process.env.IGNORES_TERM === "1") process.on("SIGTERM", () => {});
if (process.env.FLUSH_FILE) process.once("SIGTERM", () => setTimeout(() => {
  writeFileSync(process.env.FLUSH_FILE, "flushed"); process.exit(0);
}, Number(process.env.FLUSH_MS ?? 100)));
if (process.env.WITH_CHILD === "1") require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore" });
setInterval(() => {}, 60_000);
writeFileSync(process.env.PID_FILE, String(process.pid));
`;

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

describe.skipIf(process.platform === "win32")("mcp-gate and the processes it started", () => {
  let scratch: string;
  let gate: ChildProcessWithoutNullStreams | undefined;
  let serverPid = 0;

  const start = async (env: Record<string, string> = {}, direct = false) => {
    const server = join(scratch, "server.cjs");
    const pidFile = join(scratch, "server.pid");
    writeFileSync(server, SERVER);
    gate = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", GATE], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OMB_GATE_NAME: "notes",
        OMB_GATE_SPILL_DIR: join(scratch, "spill"),
        OMB_GATE_UPSTREAM: JSON.stringify({
          command: direct ? process.execPath : "/bin/sh",
          args: direct ? [server] : ["-c", `"${process.execPath}" "${server}"; exit 0`],
          env: { PID_FILE: pidFile, ...env },
        }),
      },
    }) as ChildProcessWithoutNullStreams;
    expect(await until(() => existsSync(pidFile), 20_000)).toBe(true);
    serverPid = Number(readFileSync(pidFile, "utf8"));
    expect(alive(serverPid)).toBe(true);
  };
  const exited = () => gate!.exitCode !== null || gate!.signalCode !== null;

  beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), "omb-gate-life-")); });
  afterEach(() => {
    gate?.kill("SIGKILL");
    if (serverPid) try { process.kill(serverPid, "SIGKILL"); } catch {}
    serverPid = 0;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("stops the server behind a launcher within the deadline after its input ends", async () => {
    await start();
    gate!.stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(exited()).toBe(false);
    expect(await until(exited, 8_000)).toBe(true);
    expect(await until(() => !alive(serverPid), 2_000)).toBe(true);
  }, 40_000);

  it("stops the whole tree on SIGTERM, not only the launcher", async () => {
    await start();
    gate!.kill("SIGTERM");
    expect(await until(exited, 5_000)).toBe(true);
    expect(await until(() => !alive(serverPid), 2_000)).toBe(true);
  }, 40_000);

  it.each(["SIGTERM", "SIGINT"] as const)("lets a direct MCP server flush shutdown data after %s", async (signal) => {
    const flushed = join(scratch, "flushed.txt");
    await start({ FLUSH_FILE: flushed, FLUSH_MS: "100", SETUP_DELAY_MS: "300" }, true);
    gate!.kill(signal);
    expect(await until(exited, 5_000)).toBe(true);
    expect(existsSync(flushed)).toBe(true);
    expect(readFileSync(flushed, "utf8")).toBe("flushed");
    expect(await until(() => !alive(serverPid), 2_000)).toBe(true);
  }, 40_000);

  it("lets the parent finish flushing after its descendant exits first", async () => {
    const flushed = join(scratch, "flushed.txt");
    await start({ FLUSH_FILE: flushed, FLUSH_MS: "500", WITH_CHILD: "1" }, true);
    gate!.kill("SIGTERM");
    expect(await until(exited, 5_000)).toBe(true);
    expect(existsSync(flushed)).toBe(true);
    expect(readFileSync(flushed, "utf8")).toBe("flushed");
    expect(await until(() => !alive(serverPid), 2_000)).toBe(true);
  }, 40_000);

  it("kills a server that ignores SIGTERM", async () => {
    await start({ IGNORES_TERM: "1" });
    gate!.kill("SIGTERM");
    expect(await until(exited, 6_000)).toBe(true);
    expect(await until(() => !alive(serverPid), 2_000)).toBe(true);
  }, 40_000);

  it("lets a direct upstream flush during its own SIGTERM grace period", async () => {
    const flushed = join(scratch, "flushed");
    await start({ FLUSH_FILE: flushed }, true);
    gate!.kill("SIGTERM");
    expect(await until(exited, 5_000)).toBe(true);
    expect(readFileSync(flushed, "utf8")).toBe("flushed");
  }, 40_000);
});
