import { test } from "vitest";
import assert from "node:assert/strict";
import { selectEventPull } from "./ci-draft-pr.mjs";
const repo = "example/checkout", sha = "a".repeat(40);
const event = { repository: { full_name: repo }, workflow_run: { head_sha: sha } };
const pr = { number: 1, state: "open", head: {sha}, base: { repo: { full_name: repo } } };
test("selects only the active unique revision, optionally narrowed to the recorded PR", () => {
  assert.equal(selectEventPull(event,[pr]),1);
  assert.equal(selectEventPull(event,[pr,{...pr,number:2}]),null);
  assert.equal(selectEventPull({...event,workflow_run:{...event.workflow_run,pull_requests:[{number:2}]}},[pr,{...pr,number:2}]),2);
  for(const other of [{...pr,state:"closed"},{...pr,head:{sha:"b".repeat(40)}},{...pr,base:{repo:{full_name:"else/where"}}}]) assert.equal(selectEventPull(event,[other]),null);
});
