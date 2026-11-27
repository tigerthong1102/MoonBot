import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";
import { projectTickets, trackerCommand, saveBoard } from "./tracker-board.ts";
import { run, commitOf } from "./command.ts";
import { addWorktree, checkpoint, inspectWorktree, removeCleanWorktree, setupPreview, worktreeList } from "./worktrees.ts";

const repoName = (value: unknown) => {
  if (typeof value !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error("Choose a GitHub repository with --github OWNER/REPO.");
  return value;
};
const required = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error("Provide " + name + ".");
  return value;
};
const positive = (raw: unknown) => {
  const n = Number(raw); if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Choose a positive issue, project or PR number."); return String(n);
};

export async function worktreeCommand(ctx: VerbContext) {
  const cwd = resolve(String(ctx.flags.repo || "."));
  const [action] = ctx.positionals;
  let result;
  switch (action) {
    case "list": result = { worktrees: worktreeList(cwd) }; break;
    case "create": {
      let title = ctx.flags.title, base = ctx.flags.base || "HEAD";
      if (ctx.flags.issue || ctx.flags.pr) {
        if (ctx.flags.issue && ctx.flags.pr) throw new Error("Choose one issue or one PR.");
        const repo = repoName(ctx.flags.github);
        const pr = Boolean(ctx.flags.pr);
        const item = JSON.parse(run("gh", [pr ? "pr" : "issue", "view", positive(ctx.flags.pr || ctx.flags.issue), "--repo", repo, "--json", pr ? "number,title,headRefOid" : "number,title"], cwd));
        title = title || String(item.number) + " " + item.title;
        if (pr && !ctx.flags.base) base = item.headRefOid;
      }
      result = addWorktree(cwd, required(title, "--title or --issue/--pr"), required(ctx.flags.out, "--out"), String(base));
      break;
    }
    case "show": result = inspectWorktree(cwd); break;
    case "checkpoint": result = await checkpoint(cwd, required(ctx.flags.note, "--note")); break;
    case "setup": result = setupPreview(cwd); break;
    case "remove-clean": result = removeCleanWorktree(cwd, required(ctx.flags.target, "--target")); break;
    default: throw new Error("Choose list, create, show, checkpoint, setup or remove-clean.");
  }
  return { result, human: [JSON.stringify(result, null, 2)], exitCode: EXIT.done };
}

export async function githubWork(ctx: VerbContext) {
  if (ctx.verb === "dev issues" && ctx.flags.tracker) return trackerCommand(ctx);
  const repo = repoName(ctx.flags.github);
  const cwd = resolve(String(ctx.flags.repo || "."));
  const args = (values: string[]) => JSON.parse(run("gh", values, cwd));
  let result;
  if (ctx.verb === "dev issues") {
    const issues = args(["issue", "list", "--repo", repo, "--limit", "100", "--state", "open", "--json", "number,title,url,labels,assignees"]);
    const project = ctx.flags.project ? args(["project", "item-list", positive(ctx.flags.project), "--owner", repo.split("/")[0]!, "--format", "json", "--limit", "100"]) : undefined;
    const rows = project ? projectTickets(project) : issues.map((i: { number: number; title: string; url: string }) => ({ key: "#" + i.number, title: i.title, url: i.url, status: "open" }));
    const output = ctx.flags.out ? saveBoard(String(ctx.flags.out), project ? repo.split("/")[0] + " · Project " + ctx.flags.project : repo, rows) : undefined;
    result = { repository: repo, issues, limit: 100, project, output };
  } else {
    const fields = "number,title,url,baseRefName,headRefName,isCrossRepository,state";
    const pull = args(["pr", "view", positive(ctx.flags.pr), "--repo", repo, "--json", fields]);
    const sameRepo = (rows: typeof pull[]) => rows.filter(row => !row.isCrossRepository && row.number !== pull.number);
    const relatives = (flag: string, ref: string) => sameRepo(args(["pr", "list", "--repo", repo, "--state", "open", flag, ref, "--limit", "100", "--json", fields]));
    result = { pull, parents: pull.isCrossRepository ? [] : relatives("--head", pull.baseRefName),
      children: pull.isCrossRepository ? [] : relatives("--base", pull.headRefName), relationship: "same repository, matching PR branches", limit: 100 };
  }
  return { result, human: [JSON.stringify(result, null, 2)], exitCode: EXIT.done };
}

export async function draftPull(ctx: VerbContext) {
  const repo = resolve(String(ctx.flags.repo || "."));
  const output = required(ctx.flags.out, "--out FILE");
  const head = commitOf(repo, "HEAD");
  const base = run("git", ["merge-base", head, commitOf(repo, String(ctx.flags.base || "HEAD^"))], repo).trim();
  const changes = run("git", ["diff", "--no-ext-diff", "--no-textconv", "--stat", base, head], repo).trim();
  const log = run("git", ["log", "--format=- %s", base + ".." + head], repo).trim();
  const candidates = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "PULL_REQUEST_TEMPLATE.md", "docs/pull_request_template.md"];
  const template = candidates.find(path => run("git", ["ls-tree", "--name-only", head, "--", path], repo).trim());
  const parts = ["# " + run("git", ["log", "-1", "--format=%s", head], repo).trim(), "Base " + base + "\nHead " + head, log, "~~~text\n" + changes + "\n~~~"];
  if (template) parts.push(run("git", ["show", head + ":" + template], repo));
  writeFileSync(output, parts.join("\n\n") + "\n", { mode: 0o600, flag: "wx" });
  return { result: { output: resolve(output), base, head, template: template ?? null }, human: [resolve(output)], exitCode: EXIT.done };
}
