import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { assertRestoreDatabasesIdle } from "./workspace-restore-holders.ts";

it("refuses a foreign WAL writer and admits its committed data after the writer exits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "restore db "));
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
    const db = new DatabaseSync(filename, { readOnly: true });
    try { expect(db.prepare("SELECT value FROM test").get()?.value).toBe(37); }
    finally { db.close(); }
  } finally { if (writer.exitCode === null) writer.kill(); await stopped; rmSync(dir, { recursive: true, force: true }); }
});
