import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

assert.equal(process.platform, "win32");
assert.equal(process.arch, "arm64");
const installed = resolve(process.argv[2]);
const resources = join(installed, "resources");
for (const file of [join(installed, "StartupBot.exe"), join(resources, "cua-driver.exe"), join(resources, "cua-sdk", "native", "cua_driver_sdk.dll")]) {
  const input = await open(file);
  try {
    const dos = Buffer.alloc(64);
    assert.equal((await input.read(dos, 0, dos.length, 0)).bytesRead, dos.length);
    assert.equal(dos.toString("ascii", 0, 2), "MZ", file);
    const pe = Buffer.alloc(6);
    assert.equal((await input.read(pe, 0, pe.length, dos.readUInt32LE(60))).bytesRead, pe.length);
    assert.equal(pe.readUInt32LE(), 0x4550, file);
    assert.equal(pe.readUInt16LE(4), 0xaa64, file);
  } finally {
    await input.close();
  }
}
const require = createRequire(join(resources, "duckdb", "package.json"));
const db = await require("@duckdb/node-api").DuckDBInstance.create(":memory:");
const connection = await db.connect();
try {
  const result = await connection.runAndReadAll("SELECT 42");
  assert.equal(result.getRows()[0][0], 42);
} finally {
  connection.closeSync();
  db.closeSync();
}
const chart = new (require("@resvg/resvg-js").Resvg)('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
assert.ok(chart.render().asPng().length);
console.log("Verified installed ARM64 Electron, CUA, DuckDB query and PNG render");
