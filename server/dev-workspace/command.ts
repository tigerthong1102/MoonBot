import { spawnSync } from "node:child_process";

export function run(program: "git" | "gh", args: string[], cwd: string): string {
  const result = spawnSync(program, args, {
    cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || program + " failed.");
  return result.stdout;
}

export function commitOf(cwd: string, ref: string) {
  return run("git", ["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"], cwd).trim();
}
