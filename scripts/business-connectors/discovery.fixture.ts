import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { interpretInventory, sqlGeneration } from "./discovery.ts";

const cli = fileURLToPath(new URL("./inspect-local.ts", import.meta.url));
const snapshot = (observations: unknown[], issues: string[] = []) =>
  interpretInventory({ schema: 1, observations, issues });
const entry = (name: string, version: string, view = "Registry32") => ({ kind: "registry", name, version, view });
const service = (name: string, state: string) => ({ kind: "service", name, state });

for (const [version, release] of Object.entries({
  "8.00.2039": "2000", "9.00.5000.00": "2005", "10.0.6000": "2008", "10.50.6000": "2008 R2",
  "11.0.7001": "2012", "12.0.6024": "2014", "13.0.1": "2016", "14.0.1": "2017",
  "15.0.1": "2019", "16.0.1": "2022", "17.0.1": "2025",
})) {
  test("synthetic setup version " + version, () => {
    const report = snapshot([entry("MSSQLSERVER", version)]);
    assert.equal(report.instances[0].generationHint, release);
    assert.equal(report.instances[0].serviceState, "unknown");
    assert.equal(report.connection, "untested");
  });
}

test("absent, client only and workstation without a local instance", () => {
  assert.deepEqual(snapshot([]).instances, []);
  const report = snapshot([
    service("SQLBrowser", "Stopped"), service("MSSQLFDLauncher$SME", "Running"),
    { kind: "driver", name: "ODBC Driver 18 for SQL Server", view: "Registry64" },
    { kind: "application", product: "misa-sme", version: "2023" }, { kind: "localdb-runtime" },
  ]);
  assert.deepEqual(report.instances, []);
  assert.equal(report.drivers.length, 1);
  assert.equal(report.applications[0].product, "misa-sme");
  assert.equal(report.localDbRuntimeObserved, true);
  assert.equal(report.browser, "stopped");
});

for (const state of ["Running", "Stopped"]) {
  test("legacy named and modern default instance, Browser offline, " + state, () => {
    const report = snapshot([service("MSSQL$TaiChinh", state), entry("TAICHINH", "9.00.5000"),
      entry("taichinh", "9.00.5000", "Registry64"), service("MSSQLSERVER", "Paused"),
      service("SQLBrowser", "Stopped"), entry("MSSQLSERVER", "16.0.1", "Registry64")]);
    assert.equal(report.instances.length, 2);
    assert.equal(report.instances[0].serviceState, state.toLowerCase());
    assert.equal(report.instances[0].generationHint, "2005");
    assert.equal(report.instances[0].sources.length, 3);
    assert.equal(report.instances[1].serviceState, "other");
  });
}

test("contradictory setup records and unknown releases require verification", () => {
  const report = snapshot([entry("test", "9.00.5000"), entry("test", "10.50.6000", "Registry64")]);
  assert.equal(report.instances[0].generationHint, null);
  assert.equal(report.instances[0].versionConflict, true);
  for (const version of ["10.51.12", "18.0.1", "2005", "SQLEXPRESS", "9.0.dev"]) {
    assert.equal(sqlGeneration(version), null);
  }
});

test("a vendor-looking instance is only a candidate, access failure is partial", () => {
  const report = snapshot([service("MSSQL$MISASME2023", "Running")], ["instance-registry", "applications"]);
  assert.deepEqual(report.applications, []);
  assert.equal(report.instances[0].generationHint, null);
  assert.equal(report.coverage, "partial");
  assert.equal(report.connection, "untested");
});

test("malformed or oversized inventory, arbitrary issue text and display strings", () => {
  for (const value of [null, {}, { schema: 1, observations: [], issues: ["private-message"] },
    { schema: 1, observations: Array(4097).fill({}), issues: [] }]) {
    assert.throws(() => interpretInventory(value), /invalid-inventory/);
  }
  const report = snapshot([entry("bad/path", "9.00"), entry("legacy", "secret-marker"),
    { kind: "application", product: "sapo", version: "secret-marker" }]);
  assert.equal(report.coverage, "partial");
  assert.ok(!JSON.stringify(report).includes("secret-marker"));
});

test("CLI requires explicit local scope before invoking Windows", () => {
  for (const args of [[], ["--inspect-local", "extra"], ["--remote"]]) {
    const child = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.equal(JSON.parse(child.stderr).error, "consent-required");
    assert.equal(child.stdout, "");
  }
});

test("live collector only runs on Windows", { skip: process.platform === "win32" }, () => {
  const child = spawnSync(process.execPath, [cli, "--inspect-local"], { encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stderr).error, "windows-required");
});
