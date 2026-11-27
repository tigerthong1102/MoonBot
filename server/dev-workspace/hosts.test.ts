import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./command.ts";
import { recordAttempt } from "./attempts.ts";
import { filterUserWslDistros, parseWslDistros, sshArgs } from "./hosts.ts";
it("reads Windows WSL output and filters internal Docker distributions", () => {
  expect(filterUserWslDistros(parseWslDistros("* U\0b\0u\0n\0t\0u\0\r\ndocker-desktop-data\r\nDebian\r\n"))).toEqual(["Ubuntu", "Debian"]);
  expect(() => sshArgs("-Ffile")).toThrow();
  expect(sshArgs("dev-box").prefix).toContain("StrictHostKeyChecking=yes");
});
it("records attempts per Git checkout and rejects old, mismatched and conflicting worker results", () => {
  const root = mkdtempSync(join(tmpdir(), "omb-worker-"));
  try {
    run("git", ["init"], root); run("git", ["-c","user.name=Fixture","-c","user.email=f@example.invalid","commit","--allow-empty","-m","seed"],root);
    expect(recordAttempt(root,"start",{host:"linux"})).toMatchObject({attempt:1});
    expect(() => recordAttempt(root,"start",{host:"mac"})).toThrow(/active/);
    expect(recordAttempt(root,"start",{host:"mac",retry:true})).toMatchObject({attempt:2});
    expect(() => recordAttempt(root,"finish",{host:"linux",attempt:1,exit:0})).toThrow();
    expect(() => recordAttempt(root,"finish",{host:"linux",attempt:2,exit:0})).toThrow();
    const args = {host:"mac",attempt:2,exit:0,artifact:"qa.json"};
    const receipt = recordAttempt(root,"finish",args);
    expect(recordAttempt(root,"finish",args)).toEqual(receipt);
    expect(() => recordAttempt(root,"finish",{...args,exit:1})).toThrow(/different/);
    const next = { host: "validator", afterApproved: 2 };
    expect(() => recordAttempt(root, "start", next)).toThrow(/approved/);
    const head = run("git", ["rev-parse", "HEAD"], root).trim();
    const review = { attempt: 2, head, reviewer: "reviewer" };
    expect(() => recordAttempt(root, "approve", { ...review, head: "wrong" })).toThrow(/revision/);
    const accepted = recordAttempt(root, "approve", review);
    expect(recordAttempt(root, "approve", review)).toEqual(accepted);
    expect(recordAttempt(root, "start", next)).toMatchObject({ attempt: 3, afterApproved: 2, head });
    expect(() => recordAttempt(root, "start", next)).toThrow(/latest/);
    expect(() => recordAttempt(root, "finish", args)).toThrow(/current attempt/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
