import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { writeFileAtomic } from "../atomic.ts";
import { run, commitOf } from "./command.ts";

// Copied from stablyai/orca src/shared/source-control/ai/naming/branch-name-from-work.ts,
// Copyright (c) 2026 Lovecast Inc., MIT. See public/licenses/orca.txt.
export function sanitizeBranchSlug(raw: string, maxWords = 4): string {
  const words = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean);
  if (words.length === 0) return "";
  return words.slice(0, maxWords).join("-");
}

interface TaskRecord { title: string; base: string; branch: string; progress?: string; updatedAt?: string; updatedBy?: string }

function receipt(directory: string) { return join(run("git", ["rev-parse", "--absolute-git-dir"], directory).trim(), "startupbot-task.json"); }
function taskOf(directory: string): TaskRecord | null {
  const file = receipt(directory);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function addWorktree(repo: string, title: string, destination: string, baseRef: string) {
  const slug = sanitizeBranchSlug(title).slice(0, 80);
  if (!slug) throw new Error("Choose a title containing an ASCII letter or digit.");
  const base = commitOf(repo, baseRef);
  const branch = "startupbot/" + slug;
  const directory = resolve(destination);
  if (existsSync(directory)) throw new Error("Choose a new directory for the task worktree.");
  run("git", ["worktree", "add", "-b", branch, "--", directory, base], repo);
  const record = { title, base, branch };
  writeFileSync(receipt(directory), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { directory, ...record };
}

export function worktreeList(repo: string) {
  const raw = run("git", ["worktree", "list", "--porcelain", "-z"], repo);
  return raw.split("\0\0").filter(Boolean).map(block => {
    const info = Object.fromEntries(block.split("\0").filter(Boolean).map(field => {
      const space = field.indexOf(" ");
      return space < 0 ? [field, true] : [field.slice(0, space), field.slice(space + 1)];
    }));
    return { directory: info.worktree, head: info.HEAD, branch: info.branch || null, locked: "locked" in info, prunable: "prunable" in info };
  });
}

export function inspectWorktree(directory: string) {
  return { task: taskOf(directory), head: commitOf(directory, "HEAD"), changes: run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], directory).split("\0").filter(Boolean) };
}

export async function checkpoint(directory: string, progress: string) {
  const task = taskOf(directory);
  if (!task || !progress.trim() || progress.length > 2_000) throw new Error("Choose a managed worktree and a short progress note.");
  const updated = { ...task, progress: progress.trim(), updatedAt: new Date().toISOString(), updatedBy: process.env.USERNAME || process.env.USER || "local user" };
  writeFileAtomic(receipt(directory), JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });
  return updated;
}

export function removeCleanWorktree(repo: string, target: string) {
  const directory = realpathSync.native(target);
  const targetStat = statSync(directory, { bigint: true });
  const sameDirectory = (candidate: string) => {
    const entry = statSync(candidate, { bigint: true, throwIfNoEntry: false });
    if (!entry?.isDirectory()) return false;
    // Git for Windows can print a long or differently cased spelling of the runner's TEMP directory.
    if (entry.ino && targetStat.ino) return entry.dev === targetStat.dev && entry.ino === targetStat.ino;
    return realpathSync.native(candidate) === directory;
  };
  const [primary, ...linked] = worktreeList(repo);
  if (!primary || sameDirectory(primary.directory)) throw new Error("Choose a linked StartupBot task worktree.");
  const registered = linked.find(entry => sameDirectory(entry.directory));
  if (!registered || registered.locked) throw new Error("Worktree is locked or belongs to another repository.");
  const status = inspectWorktree(directory);
  if (!status.task || registered.branch !== "refs/heads/" + status.task.branch || status.changes.length) throw new Error("The worktree must be managed, on its recorded branch and clean.");
  const ignored = run("git", ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"], directory);
  if (ignored) throw new Error("The worktree contains ignored files. Move them before cleanup.");
  run("git", ["worktree", "remove", "--", directory], repo);
  return { removed: directory, retainedBranch: status.task.branch };
}

export function setupPreview(repo: string) {
  const files = run("git", ["ls-tree", "--name-only", "HEAD", "--", "orca.yaml"], repo).trim();
  if (!files) return { scripts: {}, sharedDirectories: [] };
  const size = Number(run("git", ["cat-file", "-s", "HEAD:orca.yaml"], repo));
  if (size > 128 * 1024) throw new Error("orca.yaml exceeds the preview limit.");
  const doc = parseDocument(run("git", ["show", "HEAD:orca.yaml"], repo));
  if (doc.errors.length) throw new Error(doc.errors[0]!.message);
  const data = doc.toJS({ maxAliasCount: 20 });
  const scripts = Object.fromEntries(["setup", "archive"].filter(key => typeof data?.scripts?.[key] === "string").map(key => [key, data.scripts[key]]));
  const sharedDirectories = Array.isArray(data?.worktree?.sharedDirectories) ? data.worktree.sharedDirectories.filter((line: unknown) => typeof line === "string") : [];
  return { revision: commitOf(repo, "HEAD"), scripts, sharedDirectories };
}
