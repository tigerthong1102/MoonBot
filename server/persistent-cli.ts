import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { localFork, searchRollouts } from "./local-codex-history.ts";
import { whichOnPath } from "./bot-box/detect.ts";

const help = `terminal start NAME codex    Start Codex in a persistent local PTY in this directory.
terminal history FOLDER [QUERY]   Search local Codex session metadata by ID, project directory or branch.
terminal fork NAME FILE           Fork an external Codex rollout in its original working directory.
terminal fork-chat NAME FILE THREAD [INSTANCE]   Fork a matching StartupBot chat into its own Codex terminal.
terminal list                List sessions for this local StartupBot data directory.
terminal attach NAME         Reconnect. Press Ctrl-B then D to leave it running.
terminal output NAME         Read the last 2,000 lines of scrollback.
terminal stop NAME           Terminate this named session and its foreground command.`;

export function runPersistentCli(args: string[]): number {
  const [action, name, engine] = args;
  if (!action || action === "help" || action === "--help") { console.log(help); return 0; }
  if (action === "history" && name && args.length <= 3) { console.log(JSON.stringify(searchRollouts(name, engine))); return 0; }
  const valid = action === "list" ? args.length === 1
    : /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(name ?? "") && (
      action === "fork" ? args.length === 3 : action === "fork-chat" ? (args.length === 4 || args.length === 5) && Boolean(args[3]) :
      action === "start" ? args.length === 3 && engine === "codex"
        : ["attach", "output", "stop"].includes(action) && args.length === 2);
  if (!valid) { console.error(help); return 2; }
  if (process.platform === "win32") {
    console.error("Use the StartupBot CLI inside a WSL Linux distribution with tmux for persistent sessions.");
    return 2;
  }
  // tmux restricts its default socket directory to the OS user. Keep unrelated StartupBot profiles separate.
  const dataDir = resolve(process.env.OMB_DATA_DIR || resolve(homedir(), ".startupbot"));
  const socket = "startupbot-" + createHash("sha256").update(dataDir).digest("hex").slice(0, 24);
  const target = "=" + name;
  let command: string[];
  switch (action) {
    case "fork":
    case "fork-chat":
    case "start": {
      const codex = whichOnPath("codex");
      if (!codex) { console.error("Install the Codex CLI on this computer first."); return 1; }
      const home = resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"));
      const fork = action === "start" ? null : localFork(engine!, home, dataDir, action === "fork-chat" ? args[3] : undefined, args[4]);
      command = ["new-session", "-d", "-s", name!, "-c", process.cwd(), "-e", "CODEX_HOME=" + home, "/usr/bin/env", codex, ...(fork ? ["fork", fork.id] : [])];
      break;
    }
    case "attach":
      if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error("Attach requires an interactive terminal."); return 2; }
      command = ["attach-session", "-t", target];
      break;
    case "output": command = ["capture-pane", "-p", "-S", "-2000", "-t", target + ":"]; break;
    case "stop": command = ["kill-session", "-t", target]; break;
    default: command = ["list-sessions", "-F", "#{session_name}"]; break;
  }
  const result = spawnSync("tmux", ["-f", "/dev/null", "-L", socket, ...command], {
    stdio: action === "attach" ? "inherit" : "pipe", encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    console.error((result.error as NodeJS.ErrnoException).code === "ENOENT" ? "Install tmux on this computer to use persistent terminals." : result.error.message);
    return 1;
  }
  if (action === "list" && result.status === 1 && /no server running|No such file or directory/.test(result.stderr ?? "")) return 0;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}
