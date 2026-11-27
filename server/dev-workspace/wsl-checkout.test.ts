import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { wslCheckout } from "./wsl-checkout.ts";
import { run } from "./command.ts";
it.skipIf(process.platform !== "linux")("stages a Git bundle and undoes it without deleting the original or the copy", () => {
  const dir=mkdtempSync(join(tmpdir(),"startupbot-wsl-repo-")),repo=join(dir,"source"),dest=join(dir,"new destination");
  const inside=(args:string[])=>{
    if(args[0] === "wslpath") return args.at(-1)!;
    const r=spawnSync(args[0]!,args.slice(1),{encoding:"utf8"});if(r.status!==0)throw new Error(r.stderr);return r.stdout;
  };
  try {
    mkdirSync(repo);run("git",["init"],repo);writeFileSync(join(repo,"value"),"fixture");run("git",["add","."],repo);
    run("git",["-c","user.name=Fixture","-c","user.email=f@example.invalid","commit","-m","seed"],repo);
    expect(wslCheckout("wsl-preview",repo,dest,"",inside)).toMatchObject({targetState:"available",committedFiles:1});
    const created=wslCheckout("wsl-stage",repo,dest,"",inside);
    if (!("receipt" in created) || typeof created.receipt !== "string") throw new Error("Missing transfer receipt");
    expect(readFileSync(join(dest,"value"),"utf8")).toBe("fixture");
    expect(()=>wslCheckout("wsl-stage",repo,dest,"",inside)).toThrow();
    const index = join(dest, ".git", "index");
    const originalIndex = readFileSync(index);
    writeFileSync(index, "invalid git index");
    expect(() => wslCheckout("wsl-undo", repo, dest, created.receipt, inside)).toThrow();
    expect(readFileSync(join(dest, "value"), "utf8")).toBe("fixture");
    writeFileSync(index, originalIndex);
    writeFileSync(join(dest,"new"),"keep");expect(()=>wslCheckout("wsl-undo",repo,dest,created.receipt,inside)).toThrow();
    rmSync(join(dest,"new"));const result=wslCheckout("wsl-undo",repo,dest,created.receipt,inside);
    if (!("preservedAt" in result) || typeof result.preservedAt !== "string") throw new Error("Missing retained directory");
    expect(readFileSync(join(result.preservedAt,"value"),"utf8")).toBe("fixture");
    expect(readFileSync(join(repo,"value"),"utf8")).toBe("fixture");
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
