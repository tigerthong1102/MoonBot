import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { SessionRegistry } from "./sessions.ts";
import { freePortBlock } from "./testing/ports.ts";

let home: string;
let child: ChildProcess;
let port: number;
let log = "";
let pairedToken: string;

function call(path: string, local = false, token?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: {
      ...(local ? {} : { host: "acme.example.test", "x-forwarded-for": "203.0.113.8", "x-forwarded-proto": "https" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    } }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  port = await freePortBlock([0, 1], 35_000, 5_000);
  home = mkdtempSync(join(tmpdir(), "omb-hosted-oss-"));
  pairedToken = new SessionRegistry({ file: join(home, ".openmausbot", "sessions.json") }).issue({ label: "fixture", scopes: ["admin", "client"] }).token;
  child = spawn(process.execPath, [join(import.meta.dirname, "index.ts")], { env: {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home, USERPROFILE: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
    OMB_ENTERPRISE_DIR: join(home, "absent"), OMB_LICENSE_KEY: "fixture-only",
    OMB_ADMIN_URL: "https://admin.example.test", OMB_ADMIN_WORKSPACE: "acme",
    OMB_ADMIN_MEMBERSHIP: "portal", OMB_PUBLIC_URL: "https://acme.example.test", OMB_LOOPBACK_TRUST: "owner",
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk) => log += chunk);
  child.stderr?.on("data", (chunk) => log += chunk);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await call("/api/health", true)).status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Isolated OSS server failed to start: ${log}`);
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

it("fails closed for hosted authentication when the optional layer is absent", async () => {
  for (const path of ["/api/health/hosted", "/api/auth/hosted/start", "/api/auth/hosted/callback", "/", "/pair"]) {
    expect((await call(path)).status, `${path}: ${log}`).toBe(503);
  }
  expect((await call("/api/auth/session", false, pairedToken)).status).toBe(503);
  expect(JSON.parse((await call("/api/auth/session", true)).body).kind).toBe("loopback");
});
