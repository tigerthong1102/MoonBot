import { expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { run } from "./command.ts";
import { addWorktree, checkpoint, inspectWorktree, removeCleanWorktree, setupPreview, worktreeList } from "./worktrees.ts";

it("creates and identifies a task worktree, previews trusted revision settings and preserves a branch after clean removal", async () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-git-fixture-"));
  const repo = join(root, "repo"), task = join(root, "second checkout");
  try {
    mkdirSync(repo); run("git", ["init", "-b", "main"], repo);
    writeFileSync(join(repo, ".gitignore"), "cache\n");
    writeFileSync(join(repo, "orca.yaml"), "scripts:\n  setup: pnpm install\nworktree:\n  sharedDirectories: [.cache]\n");
    run("git", ["add", "."], repo);
    run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"], repo);
    expect(setupPreview(repo)).toMatchObject({ scripts: { setup: "pnpm install" }, sharedDirectories: [".cache"] });
    expect(addWorktree(repo, "Quarterly review", task, "main").branch).toBe("startupbot/quarterly-review");
    expect(worktreeList(repo)).toHaveLength(2);
    await checkpoint(task, "Reviewed receipts");
    expect(inspectWorktree(task).task?.progress).toBe("Reviewed receipts");
    writeFileSync(join(task, "report.txt"), "uncommitted");
    expect(() => removeCleanWorktree(repo, task)).toThrow(/clean/);
    rmSync(join(task, "report.txt"));
    writeFileSync(join(task, "cache"), "local");
    expect(() => removeCleanWorktree(repo, task)).toThrow(/ignored/);
    rmSync(join(task, "cache"));
    expect(removeCleanWorktree(repo, task).retainedBranch).toBe("startupbot/quarterly-review");
    expect(existsSync(task)).toBe(false);
    expect(run("git", ["branch", "--list", "startupbot/quarterly-review"], repo)).toContain("startupbot/quarterly-review");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
