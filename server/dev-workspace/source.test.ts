import { expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceLocation } from "./source.ts";
import { run } from "./command.ts";
import { eventIdentity } from "./ci-event.ts";
it("attributes committed and uncommitted lines separately and refuses out-of-workspace files", () => {
  const root = mkdtempSync(join(tmpdir(),"omb-source-")), repo=join(root,"repo");
  try {
    mkdirSync(repo); run("git",["init"],repo); const file=join(repo,"source.txt"); writeFileSync(file,"first\nsecond\n");
    run("git",["add","source.txt"],repo); run("git",["-c","user.name=Author","-c","user.email=fixture@example.invalid","commit","-m","seed"],repo);
    expect(sourceLocation(repo,"source.txt",1).recordedAuthor).toBe("Author");
    writeFileSync(file,"first\nthird\n");
    expect(sourceLocation(repo,"source.txt",2)).toMatchObject({source:"working tree", revision:null});
    writeFileSync(join(root,"outside.txt"),"outside");
    expect(() => sourceLocation(repo,"../outside.txt",1)).toThrow(/inside/);
  } finally { rmSync(root,{ recursive:true,force:true }); }
});
it("pins CI events to their repository, source and run attempt", () => {
  const event={repository:{full_name:"example/repo"},workflow_run:{id:24,head_sha:"b".repeat(40),run_attempt:3}};
  expect(eventIdentity(event)).toMatchObject({kind:"workflow_run",id:24,attempt:3});
  expect(() => eventIdentity({...event,workflow_run:{ ...event.workflow_run,run_attempt:0 }})).toThrow();
});
