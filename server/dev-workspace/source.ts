import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";
import { run } from "./command.ts";

export function sourceLocation(repo: string, file: string, line: number) {
  const root = realpathSync(run("git", ["rev-parse", "--show-toplevel"], repo).trim());
  const resolved = realpathSync(resolve(root, file));
  const path = relative(root, resolved);
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(".." + sep) || !statSync(resolved).isFile()) throw new Error("Choose a file inside this Git workspace.");
  if (!Number.isSafeInteger(line) || line < 1) throw new Error("Choose a positive line number.");
  const porcelain = run("git", ["--literal-pathspecs", "blame", "--line-porcelain", "-L", line + "," + line, "--", path], root);
  const sha = porcelain.split(" ", 1)[0]!;
  const uncommitted = /^0+$/.test(sha);
  return { path, resolved, line, revision: uncommitted ? null : sha, recordedAuthor: uncommitted ? null : /^author (.+)$/m.exec(porcelain)?.[1] ?? null,
    source: uncommitted ? "working tree" : "git author", summary: /^summary (.+)$/m.exec(porcelain)?.[1] ?? null };
}

export async function sourceCommand(ctx: VerbContext) {
  const repo = resolve(String(ctx.flags.repo || "."));
  const result = sourceLocation(repo, String(ctx.flags.file || ""), Number(ctx.flags.line || 1));
  const editor = String(ctx.flags.editor || "code");
  if (!["code", "cursor", "zed"].includes(editor)) throw new Error("Choose code, cursor or zed.");
  const target = result.resolved + ":" + result.line;
  const args = editor === "zed" ? [target] : ["--goto", target];
  if (ctx.flags.launch) {
    const launcher = process.platform === "win32" ? ({ code: "Code.exe", cursor: "Cursor.exe", zed: "zed.exe" } as Record<string,string>)[editor]! : editor;
    const child = spawn(launcher, args, { detached: true, stdio: "ignore", windowsHide: true });
    await new Promise<void>((ok, fail) => { child.once("error", fail); child.once("spawn", () => { child.unref(); ok(); }); });
  }
  return { result: { ...result, editor, args, opened: ctx.flags.launch === true }, exitCode: EXIT.done, human: [target, result.recordedAuthor || result.source] };
}
