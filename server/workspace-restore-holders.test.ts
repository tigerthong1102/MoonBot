import { fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { assertRestoreDatabasesIdle, assertWindowsRestoreProbe } from "./workspace-restore-holders.ts";

const procView = vi.hoisted(() => ({ mode: "normal", systemPython: true }));

it("classifies a Windows probe refusal, timeout and failure without opening the restore gate", () => {
  expect(() => assertWindowsRestoreProbe({ status: 0 })).not.toThrow();
  expect(() => assertWindowsRestoreProbe({ status: 2 })).toThrow("Another process has a workspace SQLite file open");
  expect(() => assertWindowsRestoreProbe({ status: null, error: Object.assign(new Error("private path"), { code: "ETIMEDOUT" }) }))
    .toThrow("Cannot access SQLite files for the restore preflight (ETIMEDOUT)");
  expect(() => assertWindowsRestoreProbe({ status: 1 })).toThrow("Cannot access SQLite files for the restore preflight (exit 1)");
  expect(() => assertWindowsRestoreProbe({ status: 0, error: Object.assign(new Error("failure"), { code: "EIO" }) })).toThrow();
});
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    existsSync: (path: Parameters<typeof fs.existsSync>[0]) => (path !== "/usr/bin/python3" || procView.systemPython) && fs.existsSync(path),
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (procView.mode === "hidden" && args[0] === "/proc/mounts") return "proc /proc proc rw,hidepid=2 0 0\n";
      return fs.readFileSync(...args);
    },
    readdirSync: (...args: Parameters<typeof fs.readdirSync>) => {
      if (procView.mode === "hidden" && args[0] === "/proc") return [String(process.pid)];
      if (procView.mode === "denied" && typeof args[0] === "string" && /^\/proc\/\d+\/fd$/.test(args[0])) {
        throw Object.assign(new Error("Restricted process descriptors"), { code: "EACCES" });
      }
      return fs.readdirSync(...args);
    },
  };
});

it.each(process.platform === "linux" ? ["normal", "denied", "hidden"] : ["normal"])("refuses the WAL writer and admits its committed data after exit (procfs: %s)", async mode => {
  procView.mode = mode;
  const dir = mkdtempSync(join(tmpdir(), "Đối soát O'Brien & [Q4] $ "));
  const filename = join(dir, "runtime.db"), child = join(dir, "writer.cjs");
  writeFileSync(child, `const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2]);
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE test(value); INSERT INTO test VALUES (37); BEGIN IMMEDIATE");
process.on("message", () => process.exit());
process.send("ready");`);
  const writer = fork(child, [filename], { execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const stopped = once(writer, "exit");
  try {
    await once(writer, "message");
    expect(() => assertRestoreDatabasesIdle(dir, ["runtime.db"])).toThrow(/still open by PID|process has a workspace SQLite file open/);
    writer.send("quit");
    await stopped;
    assertRestoreDatabasesIdle(dir, ["runtime.db"]);
    if (mode !== "normal") {
      vi.stubEnv("PATH", dir);
      try {
        if (existsSync("/usr/bin/python3")) assertRestoreDatabasesIdle(dir, ["runtime.db"]);
        procView.systemPython = false;
        expect(() => assertRestoreDatabasesIdle(dir, ["runtime.db"])).toThrow("Cannot confirm SQLite files are idle");
      } finally {
        procView.systemPython = true;
        vi.unstubAllEnvs();
      }
    }
    const db = new DatabaseSync(filename, { readOnly: true });
    try { expect(db.prepare("SELECT value FROM test").get()?.value).toBe(37); }
    finally { db.close(); }
  } finally {
    procView.mode = "normal";
    if (writer.exitCode === null) writer.kill();
    await stopped;
    rmSync(dir, { recursive: true, force: true });
  }
});
