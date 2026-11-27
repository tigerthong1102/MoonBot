import { spawn, spawnSync } from "node:child_process";
import { resolve, posix } from "node:path";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";
import { shellQuote } from "../browser/chrome/wrapper.ts";

// Copied from stablyai/orca src/main/wsl/discovery/wsl-distro-list-output.ts.
// Copyright (c) 2026 Lovecast Inc., MIT. See public/licenses/orca.txt.
export function filterUserWslDistros(distros: string[]): string[] {
  return distros.filter((distro) => !distro.toLowerCase().startsWith('docker-desktop'))
}
export function parseWslDistros(output: string): string[] {
  return output.replaceAll(String.fromCharCode(0), '').split(/\r?\n/).map((line) => line.trim().replace(/^\*\s*/, '')).filter(Boolean)
}

const port = (value: unknown) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error("Choose a TCP port from 1 to 65535.");
  return n;
};

export function sshArgs(host: unknown, config?: unknown) {
  if (typeof host !== "string" || !/^[a-z0-9][a-z0-9_.@-]{0,150}$/i.test(host)) throw new Error("Choose one configured SSH host or alias.");
  return { host, prefix: [...(typeof config === "string" ? ["-F", resolve(config)] : []),
    "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "-o", "ForwardAgent=no"] };
}

function execute(program: string, args: string[], encoding: BufferEncoding = "utf8") {
  const result = spawnSync(program, args, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString(encoding).trim() || program + " exited unsuccessfully.");
  return result.stdout.toString(encoding);
}

export async function hostCommand(ctx: VerbContext) {
  const [action] = ctx.positionals;
  let result;
  if (action === "wsl-list" || action === "wsl-status") {
    if (process.platform !== "win32") throw new Error("WSL discovery must run on the Windows host.");
    const distros = filterUserWslDistros(parseWslDistros(execute("wsl.exe", ["--list", "--quiet"], "utf16le")));
    if (action === "wsl-list") result = { distros };
    else {
      const distro = String(ctx.flags.distro || "");
      if (!distros.includes(distro)) throw new Error("Select a distribution listed on this computer.");
      const cwd = String(ctx.flags.folder || "");
      if (!posix.isAbsolute(cwd)) throw new Error("Choose an absolute path inside the distribution.");
      result = { distro, cwd, head: execute("wsl.exe", ["--distribution", distro, "--exec", "git", "-C", cwd, "rev-parse", "HEAD"]).trim() };
    }
  } else {
    const { host, prefix } = sshArgs(ctx.flags.host, ctx.flags.config);
    if (action === "status" || action === "tree" || action === "read") {
      const folder = String(ctx.flags.folder || "");
      if (!posix.isAbsolute(folder) || /[\r\n\0]/.test(folder)) throw new Error("Choose an absolute remote repository path.");
      const git = (args: string[]) => execute("ssh", [...prefix, host,
        ["git", "--literal-pathspecs", "-C", folder, ...args].map(shellQuote).join(" ")]);
      const head = git(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
      if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("The remote repository returned an invalid revision.");
      if (action === "status") {
        const changes = git(["status", "--porcelain=v1", "-z"]).split("\0").filter(Boolean);
        if (git(["rev-parse", "HEAD"]).trim() !== head) throw new Error("The remote checkout changed while reading status.");
        result = { host, folder, head, changes };
      } else if (action === "tree") {
        result = { host, folder, head, files: git(["ls-tree", "-r", "--name-only", "-z", head]).split("\0").filter(Boolean) };
      } else {
        const file = String(ctx.flags.file || "");
        if (!file || posix.isAbsolute(file) || file.split("/").some(bit => !bit || bit === "." || bit === "..") || file.includes("\0")) throw new Error("Choose a file from the remote Git tree.");
        const record = git(["ls-tree", "-z", head, "--", file]);
        const entry = /^(100644|100755) blob ([0-9a-f]{40,64})\t([^\0]+)\0$/s.exec(record);
        if (!entry || entry[3] !== file) throw new Error("Choose an ordinary committed file.");
        if (Number(git(["cat-file", "-s", entry[2]!])) > 256 * 1024) throw new Error("Remote previews support up to 256 KiB.");
        const text = git(["cat-file", "blob", entry[2]!]);
        if (text.includes("\0")) throw new Error("Choose a text file.");
        result = { host, folder, head, file, blob: entry[2], text };
      }
    } else if (action === "forward") {
      const local = port(ctx.flags.local), remote = port(ctx.flags.port);
      const args = [...prefix, "-o", "ExitOnForwardFailure=yes", "-N", "-T", "-L", "127.0.0.1:" + local + ":127.0.0.1:" + remote, host];
      if (!ctx.flags.connect) result = { host, local, remote, preview: "http://127.0.0.1:" + local, args, connected: false };
      else {
        const child = spawn("ssh", args, { stdio: "inherit" });
        const stop = () => { child.kill("SIGTERM"); };
        const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
        for (const signal of signals) process.once(signal, stop);
        try {
          await new Promise<void>((done, fail) => {
            child.once("error", fail);
            child.once("exit", (code, signal) => code === 0 || child.killed ? done() : fail(new Error("SSH forward ended with " + String(code ?? signal))));
          });
        } finally { for (const signal of signals) process.removeListener(signal, stop); }
        result = { host, local, remote, connected: false, closed: true };
      }
    } else throw new Error("Choose status, tree, read, forward, wsl-list or wsl-status.");
  }
  return { result, exitCode: EXIT.done, human: [JSON.stringify(result, null, 2)] };
}
