import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const child = spawnSync(process.execPath, [
  "--permission", "--allow-fs-read=" + directory, "--max-old-space-size=96", "qualification-cases.mjs",
], {
  cwd: directory, timeout: 20_000, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 32_768,
  env: { WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1" },
});
if (child.error) throw child.error;
process.stdout.write(child.stdout);
process.stderr.write(child.stderr);
process.exitCode = child.status ?? 1;
