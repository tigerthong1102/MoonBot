import assert from "node:assert/strict";
import test from "node:test";
import { setupPlan } from "./setup-plan.ts";

const baseline = { consent: "granted", data: "sql", location: "local", engine: "running",
  access: "unknown", driver: "unknown", channel: "unknown", database: "unknown", vendor: "unknown", installation: "unknown" };
const absent = { engine: "absent", vendor: "new-required" };

for (const [expected, changes] of Object.entries({
  A: {}, B: { engine:"stopped" }, C: { ...absent, location:"lan" }, D: { access:"denied" },
  E: { driver:"incompatible" }, F: absent, G: { data:"cloud" }, H: { database:"missing" },
  I: { observedVersion:"9.00.5000" }, J: { vendor:"legacy-only" }, STOP: { consent:"denied" }, UNKNOWN: {location:"unknown"},
})) {
  test("dry run " + expected, () => assert.equal(setupPlan({ ...baseline, ...changes }).scenario, expected));
}
test("refusal, tampered installer, missing admin and uncertified targets cannot produce an approved plan", () => {
  const evidence = { ...baseline, ...absent };
  assert.match(setupPlan({ ...evidence, installation:"declined" }).next, /từ chối/);
  const result = setupPlan({ ...evidence, installation:"requested", checks:{ signature:false, adminAvailable:false } });
  for (const item of ["signature","adminAvailable","certifiedTarget","independentChecksum"]) assert.ok(result.missing.includes(item));
  assert.throws(() => setupPlan({ ...evidence, certifiedTarget:"2005" }));
  for (const malformed of [2022, ["2022"]]) assert.throws(() => setupPlan({ ...evidence, certifiedTarget:malformed }));
  for (const conflicting of [{database:"identified"}, {access:"granted"}]) {
    assert.equal(setupPlan({ ...evidence, ...conflicting }).scenario, "UNKNOWN");
  }
  assert.throws(() => setupPlan({ ...evidence, checks:{ independentChecksum:"false" } }));
  assert.equal(setupPlan({ ...baseline, channel:"unsafe", access:"granted" }).scenario, "I");
  const checked = setupPlan({ ...evidence, installation:"requested", certifiedTarget:"2022", checks:{
    localHostConfirmed:true, hardwareAndOs:true, adminAvailable:true, license:true, officialInstaller:true,
    signature:true, independentChecksum:true, instanceNameAvailable:true, recoveryPlan:true,
  } });
  assert.deepEqual(checked.missing, []);
  assert.equal(checked.mode, "dry-run");
  assert.match(checked.next,/duyệt/);
});

test("Smart Pro SQL 2005 installation is a manual plan for an explicitly approved isolated lab", () => {
  const checks = { localHostConfirmed: true, hardwareAndOs: true, adminAvailable: true, license: true,
    officialInstaller: true, signature: true, independentChecksum: true, instanceNameAvailable: true, recoveryPlan: true };
  const lab = { disposableVm: true, networkDisconnected: true, cleanSnapshot: true,
    syntheticDataOnly: true, smartProBuildConfirmed: true };
  const evidence = { ...baseline, ...absent, installation: "requested", checks, smartPro2005Lab: lab };
  for (const vendor of ["new-required", "legacy-only"]) {
    assert.equal(setupPlan({ ...evidence, vendor }).scenario, "LAB_2005_MANUAL");
  }
  for (const [group, values] of Object.entries({ checks, smartPro2005Lab: lab })) {
    for (const key of Object.keys(values)) {
      const result = setupPlan({ ...evidence, [group]: { ...values, [key]: false } });
      assert.equal(result.scenario, "LAB_2005_PENDING");
      assert.deepEqual(result.missing, [key]);
    }
    assert.equal(setupPlan({ ...evidence, [group]: {} }).scenario, "LAB_2005_PENDING");
  }
  for (const change of [{ consent: "denied" }, { installation: "declined" }, { installation: "unknown" },
    { location: "lan" }, { engine: "running" }, { engine: "stopped" }, { observedVersion: "9.00.5000" },
    { channel: "unsafe" }, { database: "identified" }, { access: "denied" }, { vendor: "existing" }]) {
    assert.equal(setupPlan({ ...evidence, ...change }).scenario, "STOP");
  }
  for (const malformed of [true, null, [], { internetConnected: true }, { disposableVm: "true" }]) {
    assert.throws(() => setupPlan({ ...evidence, smartPro2005Lab: malformed }), /invalid-evidence/);
  }
  assert.throws(() => setupPlan({ ...evidence, certifiedTarget: "2022" }), /invalid-evidence/);
  assert.equal(setupPlan({ ...evidence, smartPro2005Lab: undefined }).scenario, "F");
});
