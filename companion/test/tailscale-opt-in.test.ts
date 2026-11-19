import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "src", "index.ts");
const RECORDER = pathToFileURL(join(HERE, "fixtures", "record-exec.mjs")).href;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

/** Starts a real sidecar until it says it is up, and returns every program it tried to run meanwhile. */
async function startSidecar(env: Record<string, string>): Promise<{ programs: string[][]; out: string }> {
  const home = mkdtempSync(join(tmpdir(), "omb-companion-tailscale-"));
  dirs.push(home);
  const record = join(home, "exec.jsonl");
  const [companionPort, controlPort] = [await freePort(), await freePort()];
  const child = spawn(process.execPath, ["--import", RECORDER, ENTRY], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      USERPROFILE: home,
      OMB_COMPANION_DIR: join(home, "companion"),
      OMB_PORT: "9150",
      OMB_COMPANION_PORT: String(companionPort),
      OMB_CONTROL_PORT: String(controlPort),
      OMB_COMPANION_BONJOUR: "0",
      RECORD_EXEC_FILE: record,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the sidecar never came up:\n${out}`)), 15_000);
      child.stdout.on("data", (chunk) => {
        out += chunk;
        if (out.includes("companion  ")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (chunk) => (out += chunk));
      child.once("exit", (code) => reject(new Error(`the sidecar exited (${code}):\n${out}`)));
    });
  } finally {
    child.kill("SIGKILL");
  }
  const programs = existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : [];
  return { programs, out };
}

const isTailscale = (program: string[]) => /tailscale/i.test(program[0] ?? "");

describe("the phone link and Tailscale", () => {
  it("never runs a Tailscale program when it starts, with Tailscale off or on", async () => {
    expect((await startSidecar({})).programs.filter(isTailscale)).toEqual([]);
    const on = await startSidecar({ OMB_COMPANION_ROUTES: "wifi,tailscale", OMB_COMPANION_TAILNET_NAME: "mac.tail1.ts.net" });
    expect(on.programs.filter(isTailscale)).toEqual([]);
    expect(on.out).toContain("(wifi, tailscale)");
  }, 30_000);

  it("binds no device port when only the relay or the HTTPS address is on", async () => {
    const { out } = await startSidecar({ OMB_COMPANION_ROUTES: "" });
    expect(out).toContain("no direct way in is on");
    expect(out).not.toContain("http://0.0.0.0");
  }, 30_000);
});

it("keeps its hosted route available when the device port is busy and accepts Wi-Fi once it is free", async () => {
  const home = mkdtempSync(join(tmpdir(), "startupbot-hosted-only-"));
  dirs.push(home);
  const busy = createServer();
  await new Promise<void>(resolve => busy.listen(0, "127.0.0.1", resolve));
  const phonePort = (busy.address() as { port: number }).port;
  const controlPort = await freePort();
  const token = "a".repeat(43);
  const child = spawn(process.execPath, [ENTRY], {
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home,
      OMB_COMPANION_DIR: home, OMB_COMPANION_NAME: "Fixture", OMB_COMPANION_ROUTES: "", OMB_COMPANION_BONJOUR: "0",
      OMB_PORT: String(await freePort()), OMB_WEBHOOK_PORT: String(await freePort()),
      OMB_COMPANION_PORT: String(phonePort), OMB_CONTROL_PORT: String(controlPort), OMB_CONTROL_TOKEN: token,
      OMB_COMPANION_HOSTED_URL: "https://phone.example.test",
    },
    stdio: "ignore",
  });
  const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
  const request = (route: string, method: "GET" | "POST" | "PUT", body?: unknown) => fetch(`http://127.0.0.1:${controlPort}${route}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { "x-openmausbot-control-token": token, "content-type": "application/json" },
  });
  type CompanionState = ReturnType<typeof import("../src/control.ts").companionState>;
  try {
    await expect.poll(async () => (await request("/state", "GET").catch(() => null))?.status, { timeout: 10_000 }).toBe(200);
    expect((await request("/routes", "PUT", { wifi: true, tailscale: false })).status).toBe(503);
    const before = await (await request("/pairing", "POST")).json() as CompanionState;
    expect(before.directRoutes).toEqual({ wifi: false, tailscale: false });
    expect(before.endpoints.map((endpoint: { kind: string }) => endpoint.kind)).toEqual(["hosted"]);
    await new Promise<void>(resolve => busy.close(() => resolve()));
    const after = await (await request("/routes", "PUT", { wifi: true, tailscale: false })).json() as CompanionState;
    expect(after.directRoutes.wifi).toBe(true);
    expect(after.port).toBe(phonePort);
    expect(after.pid).toBe(before.pid);
    expect(before.pairing?.token).toMatch(/^omb_pair_/);
    expect(after.pairing?.token).toBe(before.pairing?.token);
  } finally {
    if (busy.listening) busy.close();
    child.kill("SIGTERM");
    await exited;
  }
}, 20_000);
