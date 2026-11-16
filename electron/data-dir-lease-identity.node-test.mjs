import assert from "node:assert/strict";
import test from "node:test";
import { windowsCreationMatchesLease } from "./data-dir-lease.mjs";

test("a process created in the lease's millisecond stays a possible owner", () => {
  assert.equal(windowsCreationMatchesLease(1000, 1000), true);
  assert.equal(windowsCreationMatchesLease(999, 1000), true);
  assert.equal(windowsCreationMatchesLease(1001, 1000), false);
});
