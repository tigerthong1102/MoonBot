import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { reviewLines, snapshot } from "./review.ts";
import { renderReview } from "./review-page.ts";
it("anchors removal and addition on opposite revisions and escapes code in offline reviews", () => {
  const lines = reviewLines("diff --git a/a b/a\n@@ -7,2 +11,2 @@\n-old\n+<script>bad()</script>\n same\n\\ No newline at end of file\n");
  expect(lines.map(({ side, line }) => [side, line])).toEqual([["LEFT", 7], ["RIGHT", 11], ["RIGHT", 12]]);
  const result = renderReview({ base: "a".repeat(40), head: "b".repeat(40), files: [{ path: "x&y", lines, truncated: false }] }, null);
  expect(result).toContain("x&amp;y");
  expect(result).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(result).not.toContain("<script>bad()");
});

it("retains every file and review line when Git forces color and review starts in a subdirectory", () => {
  const repo = mkdtempSync(join(tmpdir(), "startupbot-review-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git("init");
    git("config", "user.email", "fixture@example.test");
    git("config", "user.name", "Fixture");
    git("config", "color.diff", "always");
    git("commit", "--allow-empty", "-m", "base");
    mkdirSync(join(repo, "sub"));
    writeFileSync(join(repo, "another"), "first\n");
    writeFileSync(join(repo, "sub/note"), "second\n");
    git("add", ".");
    git("commit", "-m", "add files");
    const { files } = snapshot(join(repo, "sub"), "HEAD^");
    expect(files.map(file => [file.path, file.lines[0]?.text])).toEqual([["another", "+first"], ["sub/note", "+second"]]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
