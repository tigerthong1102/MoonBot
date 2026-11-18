import assert from "node:assert/strict";
import { test } from "node:test";
import { simulatedEntitlementsFromDump } from "./ios-simulator-entitlements.mjs";

test("reads real otool little-endian words without their addresses", () => {
  const dump = `fixture:
Contents of (__TEXT,__entitlements) section
000000010000038c 6d783f3c 6576206c 6f697372 31223d6e
000000010000039c 3f22302e 6c703c3e 20747369 73726576
00000001000003ac 3d6e6f69 302e3122 643c3e22 3e746369`;
  assert.equal(simulatedEntitlementsFromDump(dump), '<?xml version="1.0"?><plist version="1.0"><dict>');
});
test("keeps a missing simulated section empty", () => {
  assert.equal(simulatedEntitlementsFromDump("StartupBot.app/StartupBot:\n"), "");
});
test("rejects corrupted section words", () => {
  assert.throws(() => simulatedEntitlementsFromDump("000000010000038c not-hex"), /Malformed/);
});
test("does not expose terminal NUL padding as part of XML", () => {
  assert.equal(simulatedEntitlementsFromDump("000000010000038c 00003e3c"), "<>");
});
