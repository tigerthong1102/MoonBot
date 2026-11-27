import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { registerSimulatorInspector } from "./local-simulator.mjs";
import { commandPath } from "./shell-path.mjs";

async function invoke(args, input) {
  const env = { ...process.env, PATH: await commandPath() };
  return new Promise((done, fail) => {
    const child = execFile("tmux", args, { env, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { fail(Object.assign(err, { stderr })); return; }
      done(stdout);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

/** Use the same per-user socket as the installed StartupBot terminal CLI. No shell or user-supplied tmux options. */
export async function localTerminalPane(dataDir, action, target, input, run = invoke) {
  const socket = "startupbot-" + createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 24);
  const cmd = (args, value) => run(["-f", "/dev/null", "-L", socket, ...args], value);
  let inventory;
  try { inventory = await cmd(["list-panes", "-a", "-F", "#{pid}/#{session_created}/#{pane_id}\t#{session_name}"]); }
  catch (err) {
    if (action === "list" && (err.code === "ENOENT" || /no server running|No such file or directory/.test(err.stderr || ""))) return [];
    throw err;
  }
  const panes = inventory.trim().split("\n").flatMap(line => {
    const [id, name] = line.split("\t");
    return /^\d+\/\d+\/%\d+$/.test(id) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(name ?? "") ? [{ id, name }] : [];
  });
  if (action === "list") return panes;
  const selected = panes.find(item => item.id === target);
  if (!selected) throw new Error("Terminal session ended.");
  const pane = selected.id.split("/").at(-1);
  if (action === "read") return cmd(["capture-pane", "-p", "-S", "-2000", "-t", pane]);
  if (action !== "send" || typeof input !== "string" || !input || input.length > 4096 || Array.from(input).some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159); })) throw new Error("Enter one line of terminal input.");
  const buffer = "startupbot-ui-" + randomUUID();
  await cmd(["load-buffer", "-b", buffer, "-"], input);
  try {
    await cmd(["paste-buffer", "-d", "-b", buffer, "-t", pane]);
    await cmd(["send-keys", "-t", pane, "Enter"]);
  } finally { await cmd(["delete-buffer", "-b", buffer]).catch(() => {}); }
}

export function registerLocalDeveloperPanes(ipc, guard, folder) {
  registerSimulatorInspector(ipc, guard, () => Boolean(folder()));
  registerLocalTerminalPane(ipc, guard, folder);
}

export function registerLocalTerminalPane(ipc, guard, folder) {
  ipc.handle("terminal:pane", guard("terminal:pane", (event, action, target, input) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error("Use the main desktop window.");
    const dataDir = folder();
    if (!dataDir || process.platform === "win32") throw new Error("Choose the local computer.");
    return localTerminalPane(dataDir, action, target, input);
  }));
}
