import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const execute = promisify(execFile);
const run = async (args) => (await execute("/usr/bin/xcrun", args, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 })).stdout;

// Device parsing copied from stablyai/orca src/main/emulator/simctl-simulator-devices.ts.
// Copyright (c) 2026 Lovecast Inc. See public/licenses/orca.txt.
const UDID_RE = /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/i;
export function parseSimctlDevices(stdout) {
  const data = JSON.parse(stdout || '{}');
  const devices = [];
  for (const [runtime, runtimeDevices] of Object.entries(data.devices ?? {})) {
    for (const device of runtimeDevices) {
      if (!device.udid) continue;
      devices.push({
        name: device.name ?? device.udid,
        udid: device.udid,
        state: device.state ?? 'unknown',
        runtime,
        isAvailable: device.isAvailable,
        lastUsedAt: device.lastUsedAt ?? device.lastBootedAt,
        availabilityError: device.availabilityError,
      });
    }
  }
  return devices;
}

export async function bootedSimulators(invoke = run) {
  return parseSimctlDevices(await invoke(["simctl", "list", "devices", "booted", "--json"]))
    .filter(d => d.state === "Booted" && d.isAvailable !== false && UDID_RE.test(d.udid) && /\.iOS-/.test(d.runtime))
    .map(({ name, udid, runtime }) => ({ name, udid, runtime }));
}

export async function simulatorCapture(udid, invoke = run) {
  if (typeof udid !== "string" || !UDID_RE.test(udid)) throw new Error("Choose a booted iOS Simulator.");
  const device = (await bootedSimulators(invoke)).find(d => d.udid === udid);
  if (!device) throw new Error("The selected iOS Simulator is no longer booted.");
  const dir = await mkdtemp(join(tmpdir(), "startupbot-simulator-"));
  const file = join(dir, "capture.png");
  try {
    await invoke(["simctl", "io", device.udid, "screenshot", file]);
    if ((await stat(file)).size > 16 * 1024 * 1024) throw new Error("The simulator capture exceeds 16 MiB.");
    const bytes = await readFile(file);
    if (!bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new Error("Invalid simulator image.");
    return { device, at: new Date().toISOString(), png: bytes.toString("base64") };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export function registerSimulatorInspector(ipc, guard, local) {
  ipc.handle("simulator:inspect", guard("simulator:inspect", async (event, action, id) => {
    if (!local() || process.platform !== "darwin" || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error("Use the local Mac window.");
    if (action === "list") return bootedSimulators();
    if (action === "capture") return simulatorCapture(id);
    throw new Error("Unknown simulator operation.");
  }));
}
