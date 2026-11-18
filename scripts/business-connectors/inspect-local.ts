import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { interpretInventory } from "./discovery.ts";

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--inspect-local") throw new Error("consent-required");
  if (process.platform !== "win32") throw new Error("windows-required");
  const root = process.env.SystemRoot;
  if (!root || !/^[a-z]:\\/i.test(root)) throw new Error("windows-system-directory-unavailable");
  const executable = win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = fileURLToPath(new URL("./windows-inventory.ps1", import.meta.url));
  let stdout: string;
  try {
    const command = promisify(execFile)(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script], {
      timeout: 30_000, maxBuffer: 512 * 1024, windowsHide: true, cwd: win32.dirname(executable),
      env: { SystemRoot: root, WINDIR: root, PSModulePath: win32.join(win32.dirname(executable), "Modules"),
        TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA, PATH: win32.join(root, "System32") },
    });
    command.child.stdin?.end();
    ({ stdout } = await command);
  } catch (error) {
    if (error && typeof error === "object" && "killed" in error && error.killed) throw new Error("inventory-timeout");
    throw new Error("inventory-unavailable");
  }
  let report;
  try { report = interpretInventory(JSON.parse(stdout.replace(/^\uFEFF/, ""))); }
  catch { throw new Error("invalid-inventory"); }
  process.stdout.write(JSON.stringify(report) + "\n");
  if (report.coverage === "partial") process.exitCode = 2;
}

main().catch((error: Error) => {
  process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
  process.exitCode = 1;
});
