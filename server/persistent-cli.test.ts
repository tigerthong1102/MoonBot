import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, it } from "vitest";

const entry = join(import.meta.dirname, "openmausbot.ts");
const hasTmux = process.platform !== "win32" && spawnSync("tmux", ["-V"]).status === 0;
it.skipIf(!hasTmux)("keeps the same PTY process through separate CLI invocations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-terminal-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "codex"), '#!/bin/sh\nprintf "READY-%s\\n" "$$"\nwhile read -r line; do printf "%s\\n" "$line"; done\n', { mode: 0o700 });
  const run = (args: string[], profile = dir) => spawnSync(process.execPath, ["--experimental-strip-types", entry, "terminal", ...args], {
    encoding: "utf8", timeout: 15_000, env: { ...process.env, PATH: bin + delimiter + process.env.PATH, OMB_DATA_DIR: profile },
  });
  try {
    expect(run(["start", "demo", "codex"]).status).toBe(0);
    await expect.poll(() => run(["output", "demo"]).stdout, { timeout: 10_000 }).toMatch(/READY-\d+/);
    const output = run(["output", "demo"]);
    expect(run(["list"]).stdout.trim()).toBe("demo");
    expect(run(["start", "demo", "codex"]).status).not.toBe(0);
    expect(run(["output", "dem"]).status).not.toBe(0);
    expect(run(["list"], join(dir, "other")).stdout.trim()).toBe("");
    expect(run(["output", "demo"]).stdout).toEqual(output.stdout);
    expect(run(["stop", "demo"]).status).toBe(0);
    expect(run(["list"]).stdout.trim()).toBe("");
  } finally {
    run(["stop", "demo"]);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
