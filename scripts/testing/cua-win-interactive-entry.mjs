import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "node:util";

if (process.env.OMB_CUA_ISOLATED_DESKTOP !== "1" || process.argv.length !== 3) {
  throw new Error("Start the qualification entry with the private desktop launcher and a log path");
}
const log = resolve(process.argv[2]);
writeFileSync(log, "", { flag: "wx" });
for (const level of ["log", "error"]) {
  console[level] = (...args) => appendFileSync(log, format(...args) + "\n");
}
process.argv.push("--qualify-interactive");
await import("../smoke-cua-win-embedded.mjs");
