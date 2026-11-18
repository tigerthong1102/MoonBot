import assert from "node:assert/strict";
import test from "node:test";
import { assessEngine, classifyProbeFailure } from "./compatibility.ts";

test("metadata fixtures keep engine version independent of DB compatibility level", () => {
  const edition = "Express Edition";
  assert.deepEqual(assessEngine({ productVersion: "9.00.5000.00", edition, compatibilityLevel: 80 }),
    { generation: "2005", next: "vendor-export" });
  for (const version of ["10.0.6000", "10.50.6000"]) {
    assert.equal(assessEngine({ productVersion: version, edition, compatibilityLevel: 90 }).next, "verify-tls-patch-and-driver");
  }
  assert.equal(assessEngine({ productVersion: "16.0.1000.6", edition, compatibilityLevel: 100 }).next, "verify-driver-channel-and-grant");
  assert.equal(assessEngine({ productVersion: "18.0.1", edition }).next, "verify-engine");
  assert.equal(assessEngine({ productVersion: "16.0.1", edition: "" }).next, "verify-engine");
});

test("synthetic legacy login, driver and channel failures never suggest credential or TLS retries", () => {
  assert.equal(classifyProbeFailure({ stage: "login", nativeCode: 18456 }), "authentication-refused");
  assert.equal(classifyProbeFailure({ stage: "login", sqlState: "28000" }), "authentication-refused");
  assert.equal(classifyProbeFailure({ stage: "read", nativeCode: 229 }), "permission-denied");
  assert.equal(classifyProbeFailure({ stage: "tls", sqlState: "08001" }), "secure-transport-failed");
  assert.equal(classifyProbeFailure({ stage: "resolve", sqlState: "IM002" }), "driver-unavailable");
  assert.equal(classifyProbeFailure({ stage: "read", sqlState: "08S01" }), "connection-interrupted");
  assert.equal(classifyProbeFailure({ stage: "read", nativeCode: 8645 }), "server-busy");
  assert.equal(classifyProbeFailure({ stage: "read", sqlState: "HYT00" }), "timeout");
  assert.equal(classifyProbeFailure({ stage: "read", sqlState: "00000" }), "unknown");
});
