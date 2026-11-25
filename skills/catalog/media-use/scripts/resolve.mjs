#!/usr/bin/env node
import "./lib/windows-exe-search.mjs";
import { spawnSync } from "node:child_process";
import { resolveNpxInvocation } from "./lib/npx-sync.mjs";

// Only the explicitly selected CLI may run; project-local packages are not trusted.
try {
  const invocation = resolveNpxInvocation(
    ["hyperframes", "media-use", "resolve", ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  const result = spawnSync(invocation.cmd, invocation.args, invocation.opts);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
