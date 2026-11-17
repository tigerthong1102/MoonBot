import assert from "node:assert/strict";
import test from "node:test";
import { tasklistListsPid, windowsCreationMatchesLease } from "./data-dir-lease.mjs";

test("a process created in the lease's millisecond stays a possible owner", () => {
  assert.equal(windowsCreationMatchesLease(1000, 1000), true);
  assert.equal(windowsCreationMatchesLease(999, 1000), true);
  assert.equal(windowsCreationMatchesLease(5999, 1000), true);
  assert.equal(windowsCreationMatchesLease(6000, 1000), false);
});

test("tasklist uses CIM fallback when the listing has no usable result", () => {
  assert.equal(tasklistListsPid('\uFEFF"node.exe","4120","Console","1","64,000 K"\r\n'), true);
  assert.equal(tasklistListsPid("INFO: No tasks are running which match the specified criteria."), false);
  assert.equal(tasklistListsPid("INFORMATION : aucune tâche en service"), false);
  assert.equal(tasklistListsPid("ERROR: Access is denied."), null);
  assert.equal(tasklistListsPid("\r\n"), null);
});
