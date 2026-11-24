import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { qualifyLinuxChat } from "./testing/cua-linux-chat-smoke.mjs";

assert.equal(process.env.XDG_SESSION_TYPE, "wayland");
assert.ok(process.env.WAYLAND_DISPLAY);
const driver = resolve("dist-native/cua-linux-x64/cua-driver");
const scratch = mkdtempSync(join(tmpdir(), "startupbot-wayland-"));
const socket = join(scratch, "driver.sock");
const child = spawn(driver, ["serve", "--embedded", "--no-overlay", "--socket", socket, "--pid-file", join(scratch, "driver.pid"), "--permission-mode", "standard"], {
  env: { ...process.env, CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_PARENT_LIVENESS_STDIN: "1", CUA_DRIVER_RS_ENABLE_WAYLAND: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "false", CUA_DRIVER_RS_UPDATE_CHECK: "false" }, stdio: ["pipe", "ignore", "pipe"],
});
const py = `import gi\ngi.require_version("Gtk", "3.0")\nfrom gi.repository import Gtk\nw=Gtk.Window(title="StartupBot Wayland Start")\nw.set_default_size(360,180)\nb=Gtk.Button(label="Open report")\nb.connect("clicked",lambda *_:w.set_title("StartupBot Wayland Done"))\nw.add(b)\nw.connect("destroy",Gtk.main_quit)\nw.show_all()\nGtk.main()`;
const fixture = spawn("/usr/bin/python3", ["-u", "-c", py], { env: { ...process.env, GDK_BACKEND: "wayland", NO_AT_BRIDGE: "0", GTK_MODULES: "gail:atk-bridge" }, stdio: ["ignore", "ignore", "pipe"] });
const fixtureTitle = "StartupBot Wayland multi-step";
const multi = `import ctypes\nctypes.CDLL(None).prctl(15,b"omb-gtk-test",0,0,0)\nimport gi\ngi.require_version("Gtk", "3.0")\nfrom gi.repository import Gtk\nw=Gtk.Window(title=${JSON.stringify(fixtureTitle)})\nw.set_default_size(360,180)\nb=Gtk.Button(label="Reports")\ndef clicked(button):\n if button.get_label()=="Reports":\n  w.set_title("Reports screen")\n  button.set_label("Open report")\n else:\n  w.set_title("StartupBot Linux destination")\nb.connect("clicked", clicked)\nw.add(b)\nw.connect("destroy", Gtk.main_quit)\nw.show_all()\nGtk.main()`;
const startFixture = () => spawn("/usr/bin/python3", ["-u", "-c", multi], { env: { ...process.env, GDK_BACKEND: "wayland", NO_AT_BRIDGE: "0", GTK_MODULES: "gail:atk-bridge" }, stdio: ["ignore", "ignore", "pipe"] });
const stop = async proc => {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  for (let i = 0; i < 50 && proc.exitCode === null && proc.signalCode === null; i++) await delay(100);
};
const until = async (probe, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await delay(100);
  }
  throw new Error("timed out waiting for " + label);
};
let proxy;
try {
  for (let i = 0; i < 200 && !existsSync(socket); i++) await delay(100);
  assert.ok(existsSync(socket), "driver socket missing");
  proxy = spawn(driver, ["mcp", "--embedded", "--socket", socket], { env: { ...process.env, CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_RS_ENABLE_WAYLAND: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "false" }, stdio: ["pipe", "pipe", "pipe"] });
  const waiters = new Map();
  createInterface({ input: proxy.stdout }).on("line", line => {
    const item = JSON.parse(line); const waiter = waiters.get(item.id);
    if (waiter) { waiters.delete(item.id); waiter(item); }
  });
  let id = 0;
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id;
    const timer = setTimeout(() => reject(new Error(method + " timed out")), 30000);
    waiters.set(current, result => { clearTimeout(timer); result.error ? reject(new Error(result.error.message)) : resolve(result.result); });
    proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) + "\n");
  });
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "wayland-fixture", version: "1" } });
  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const call = async (name, args = {}) => {
    const result = await rpc("tools/call", { name, arguments: args });
    console.log("WAYLAND_CALL", JSON.stringify({ name, isError: result.isError, data: result.structuredContent }));
    assert.notEqual(result.isError, true, name);
    return result.structuredContent;
  };
  await call("start_session", { session: "wayland-fixture", capture_scope: "window" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    const data = await call("list_windows", { session: "wayland-fixture", pid: fixture.pid });
    target = data?.windows?.find(window => window.title === "StartupBot Wayland Start");
    if (!target) await delay(500);
  }
  assert.ok(target, "native Wayland GTK window not found");
  const address = { session: "wayland-fixture", pid: fixture.pid, window_id: target.window_id };
  const before = await call("get_window_state", { ...address, tree_format: "elements", include_screenshot: false });
  const button = before?.elements?.find(row => row.role === "push button" && row.label === "Open report");
  assert.ok(button?.element_token, "Wayland button token missing");
  await call("click", { ...address, element_token: button.element_token, delivery_mode: "background" });
  const after = await call("get_window_state", { ...address, tree_format: "elements", include_screenshot: false });
  assert.equal(after?.window_title, "StartupBot Wayland Done");
  console.log("WAYLAND_NATIVE_CLICK_PASS");
  await stop(fixture);
  await qualifyLinuxChat({ driver, driverProcess: child, socketPath: socket, sandbox: scratch, fixtureTitle,
    startFixture, rpc, session: "wayland-fixture", stop, until, multi: true, wayland: true });
} finally {
  proxy?.kill("SIGTERM");
  fixture.kill("SIGTERM");
  child.stdin.end();
  child.kill("SIGTERM");
  rmSync(scratch, { force: true, recursive: true });
}

