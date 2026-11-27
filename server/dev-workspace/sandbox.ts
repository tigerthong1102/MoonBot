import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";
import { run, commitOf } from "./command.ts";

const label = "ai.startupbot.dev-task";
function docker(args: string[], input?: Buffer) {
  const r = spawnSync("docker", args, { input, timeout: 60_000, maxBuffer: 2_048_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr.toString().trim() || "Docker operation failed.");
  return r.stdout.toString().trim();
}

export async function sandboxCommand(ctx: VerbContext) {
  const repo = resolve(String(ctx.flags.repo || "."));
  const gitDir = realpathSync(run("git", ["rev-parse", "--absolute-git-dir"], repo).trim());
  const owner = createHash("sha256").update(userInfo().username + "\0" + gitDir).digest("hex");
  const [action] = ctx.positionals;
  let result;
  if (action === "list") {
    result = { containers: docker(["ps", "--filter", "label=" + label + "=" + owner, "--format", "{{json .}}"]).split("\n").filter(Boolean).map(line => JSON.parse(line)) };
  } else if (action === "start") {
    const image = String(ctx.flags.image || ""), minutes = Number(ctx.flags.minutes || 30);
    if (!image || image.startsWith("-") || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Choose a local Docker image and a lifetime of 1–1440 minutes.");
    const head = commitOf(repo, "HEAD");
    const archive = spawnSync("git", ["archive", "--format=tar", head], { cwd: repo, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    if (archive.error || archive.status !== 0) throw new Error("The committed task archive could not be prepared within 64 MiB.");
    const id = docker(["run", "--detach", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--memory=512m", "--pids-limit=128", "--tmpfs", "/workspace:rw,size=384m", "--tmpfs", "/tmp:rw,size=32m", "--label", label + "=" + owner,
      "--label", "ai.startupbot.revision=" + head, "--workdir", "/workspace", "--entrypoint", "sleep", image, String(minutes * 60)]);
    try { docker(["exec", "-i", "--workdir", "/workspace", id, "tar", "-xf", "-"], archive.stdout); }
    catch (error) { docker(["stop", "--time", "1", id]); throw error; }
    result = { id, image, head, ttlMinutes: minutes, directory: "/workspace" };
  } else if (action === "stop") {
    const id = String(ctx.flags.id || "");
    if (!/^[a-f0-9]{64}$/.test(id) || docker(["inspect", "--format", '{{index .Config.Labels "' + label + '"}}', id]) !== owner) throw new Error("Select a full container ID owned by this task checkout.");
    docker(["stop", "--time", "3", id]); result = { stopped: id };
  } else throw new Error("Choose list, start or stop.");
  return { result, exitCode: EXIT.done, human: [JSON.stringify(result, null, 2)] };
}
