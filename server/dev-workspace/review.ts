import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";
import { run, commitOf } from "./command.ts";
import { readPull } from "./github.ts";
import { renderReview } from "./review-page.ts";

export interface ReviewLine { side: "LEFT" | "RIGHT"; line: number; text: string }
export function reviewLines(diff: string): ReviewLine[] {
  const rows: ReviewLine[] = [];
  let left = 0, right = 0, inHunk = false;
  for (const text of diff.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (header) { left = Number(header[1]); right = Number(header[2]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (text.startsWith("+")) rows.push({ side: "RIGHT", line: right++, text });
    else if (text.startsWith("-")) rows.push({ side: "LEFT", line: left++, text });
    else if (text.startsWith(" ")) { rows.push({ side: "RIGHT", line: right++, text }); left++; }
  }
  return rows;
}

export function snapshot(cwd: string, baseRef: string, expectedHead?: string) {
  const root = run("git", ["rev-parse", "--show-toplevel"], cwd).trimEnd();
  const head = commitOf(root, "HEAD");
  if (expectedHead && expectedHead !== head) throw new Error("Check out the PR's exact head before generating a review.");
  const base = run("git", ["merge-base", commitOf(root, baseRef), head], root).trim();
  const options = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"];
  const paths = run("git", ["diff", ...options, "--name-only", "-z", base, head], root).split("\0").filter(Boolean);
  let remaining = 30_000;
  const files = paths.map(path => {
    if (!remaining) return { path, lines: [], truncated: true };
    const diff = run("git", ["--literal-pathspecs", "diff", ...options, base, head, "--", path], root);
    const all = reviewLines(diff);
    const lines = all.slice(0, remaining);
    remaining -= lines.length;
    return { path, lines, truncated: all.length > lines.length };
  });
  return { base, head, files };
}

export async function reviewCommand(ctx: VerbContext) {
  const cwd = resolve(String(ctx.flags.repo || "."));
  const output = ctx.flags.out;
  if (typeof output !== "string") throw new Error("Choose a new review HTML file with --out.");
  if (Boolean(ctx.flags.github) !== Boolean(ctx.flags.pr)) throw new Error("--github OWNER/REPO and --pr NUMBER go together.");
  const pull = ctx.flags.github ? readPull(cwd, String(ctx.flags.github), Number(ctx.flags.pr)) : null;
  const review = snapshot(cwd, pull?.base || String(ctx.flags.base || "HEAD^"), pull?.head);
  writeFileSync(output, renderReview(review, pull), { flag: "wx", mode: 0o600 });
  return { result: { output: resolve(output), base: review.base, head: review.head, files: review.files.length }, exitCode: EXIT.done, human: [resolve(output)] };
}
