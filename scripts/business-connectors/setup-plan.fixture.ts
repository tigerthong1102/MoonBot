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
