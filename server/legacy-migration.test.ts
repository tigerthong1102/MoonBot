// Starting StartupBot must not move or replace another installation's data.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { workerPort } from "./testing/worker-port.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = workerPort(18800, 10_000);
const WEBHOOK_PORT = workerPort(39000, 10_000);

let home: string;
let child: ChildProcess;
let stderr = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-legacy-test-"));
  const legacy = join(home, ".opengrokbot");
  mkdirSync(legacy, { recursive: true });
  // A non-product shadow: an empty map would select the full default fleet, whose CLI probes are not part of this test.
  writeFileSync(join(legacy, "config.json"), JSON.stringify({
    instances: { fixture: { driver: "migration-test-shadow" } },
  }));
  writeFileSync(join(legacy, "keep-me.txt"), "carried over");
  const upstream = join(home, ".openmausbot");
  mkdirSync(upstream, { recursive: true });
  writeFileSync(join(upstream, "keep-me.txt"), "upstream data");
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(PORT),
      OMB_WEBHOOK_PORT: String(WEBHOOK_PORT),
      OMB_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${stderr}`);
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(home);
});

describe("other installations' data", () => {
  it("leaves existing folders untouched and creates a separate environment", () => {
    const fresh = join(home, ".startupbot");
    expect(existsSync(join(home, ".opengrokbot"))).toBe(true);
    expect(readFileSync(join(home, ".opengrokbot", "keep-me.txt"), "utf8")).toBe("carried over");
    expect(readFileSync(join(home, ".openmausbot", "keep-me.txt"), "utf8")).toBe("upstream data");
    expect(existsSync(join(fresh, "keep-me.txt"))).toBe(false);
    expect(readFileSync(join(fresh, "environment-id"), "utf8").trim()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
