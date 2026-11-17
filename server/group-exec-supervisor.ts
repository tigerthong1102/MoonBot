export const GROUP_SUPERVISOR = String.raw`
const { spawn } = require("node:child_process");
const [electronNode, file, ...args] = process.argv.slice(1);
const env = { ...process.env };
if (electronNode === "unset") delete env.ELECTRON_RUN_AS_NODE;
else env.ELECTRON_RUN_AS_NODE = electronNode;
let stopping = false;
const stop = (graceMs = 2000) => {
  if (stopping) return;
  stopping = true;
  // This live group member pins its group identity until escalation targets its own group.
  setTimeout(() => process.kill(0, "SIGKILL"), graceMs);
  process.kill(0, "SIGTERM");
};
process.on("SIGTERM", () => stop());
process.on("message", message => { if (Number.isFinite(message?.stop)) stop(Math.max(0, message.stop)); });
const child = spawn(file, args, { env, stdio: ["pipe", "pipe", "pipe"] });
process.stdin.pipe(child.stdin);
child.stdin.on("error", () => {});
process.stdin.on("error", () => {});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once("error", error => process.send?.({ spawnError: { message: error.message, code: error.code, errno: error.errno, syscall: error.syscall, path: error.path } }));
child.once("close", (code, signal) => {
  if (stopping) return;
  process.stdin.destroy();
  process.disconnect?.();
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else process.exitCode = code ?? 1;
});
`;
