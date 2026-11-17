import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { app: { type: "string" }, output: { type: "string" } } });
assert(values.app, "--app must name the packaged application");
const app = path.resolve(values.app);
const mac = process.platform === "darwin";
const resources = mac ? path.join(app, "Contents", "Resources") : path.join(path.dirname(app), "resources");
const executable = mac ? path.join(app, "Contents", "MacOS", "StartupBot") : app;
const evidence = path.resolve(values.output ?? path.join(root, "release", "internal", "smoke"));
mkdirSync(evidence, { recursive: true });
assert(existsSync(executable), "The packaged executable is missing");
for (const entry of ["app.asar", "server/index.js", "ui/index.html", "browser-engine/manifest.json", "licenses/OpenMausBot-LICENSE.txt", "licenses/OpenMausBot-NOTICE.txt"]) {
  assert(existsSync(path.join(resources, entry)), `Missing packaged resource: ${entry}`);
}
const fixture = mkdtempSync(path.join(tmpdir(), "startupbot-package-"));
const home = path.join(fixture, "home");
const data = path.join(home, ".startupbot");
const profile = path.join(fixture, "electron-profile");
mkdirSync(data, { recursive: true });
mkdirSync(profile, { recursive: true });
const legacy = path.join(home, ".openmausbot");
mkdirSync(legacy);
const sentinel = path.join(legacy, "do-not-modify.txt");
writeFileSync(sentinel, "upstream fixture data must remain unchanged\n");
const sentinelHash = createHash("sha256").update(readFileSync(sentinel)).digest("hex");
const reply = "StartupBot packaged agent fixture answered successfully";
writeFileSync(path.join(data, "config.json"), JSON.stringify({ language: "en", features: { smartSetupChoices: false }, instances: {
  claude: { driver: "claudeAgent", displayName: "Internal package fixture", config: { cli: path.join(root, "server", "testing", "fake-claude-cli.ts") },
    environment: { FAKE_CLAUDE_REPLIES: JSON.stringify([reply]), FAKE_CLAUDE_MODE: "happy" } },
} }));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function until(read, label, ms = 90_000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ""}`);
}
const port = await freePort();
const webhook = await freePort();
const debug = await freePort();
const env = { PATH: process.env.PATH, HOME: mac ? process.env.HOME : home, USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
  OMB_DATA_DIR: data, OMB_SMOKE_HOME: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(webhook),
  OMB_SMOKE_TEST: "1", OMB_SMOKE_KEEP_OPEN: "1", OMB_SMOKE_CUA: "0",
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {}),
  ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}),
};
const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, "--remote-debugging-address=127.0.0.1", "--no-first-run"];
const child = spawn(executable, args, { cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
const launchLog = path.join(evidence, "desktop-smoke.log");
writeFileSync(launchLog, "");
child.stdout.on("data", bytes => { output += bytes; appendFileSync(launchLog, bytes); });
child.stderr.on("data", bytes => { output += bytes; appendFileSync(launchLog, bytes); });
child.on("error", error => { output += `\n${error.stack}\n`; });
let socket;
let report = { platform: process.platform, arch: process.arch, app, status: "FAIL" };
try {
  const target = await until(async () => {
    if (child.exitCode !== null) throw new Error(`Application exited with ${child.exitCode}`);
    const list = await fetch(`http://127.0.0.1:${debug}/json/list`, { signal: AbortSignal.timeout(2_000) }).then(r => r.json());
    return list.find(item => item.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(item.url));
  }, "the packaged renderer");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  socket.addEventListener("close", () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Packaged renderer disconnected")); } pending.clear(); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 30_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await until(() => evaluate("Boolean(window.ogb?.getCapabilities && document.readyState === 'complete')"), "the preload bridge");
  const request = (route, body) => evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route)},${JSON.stringify(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })});return {status:r.status,body:await r.json()};})()`);
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  const edition = await request("/api/edition");
  assert.equal(edition.status, 200); assert.equal(edition.body.edition, "oss");
  const title = await evaluate("document.title");
  assert.match(title, /StartupBot/);
  const capabilities = await evaluate("window.ogb.getCapabilities()");
  const catalog = await request("/api/instances");
  assert.equal(catalog.status, 200); assert(JSON.stringify(catalog.body).includes("Internal package fixture"));
  const created = await request("/api/bots", { name: "Internal package agent", cwd: home });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bot = created.body.bot;
  assert(bot?.id, "Bot creation did not return its identity");
  const sent = await request(`/api/bots/${encodeURIComponent(bot.id)}/messages`, { text: "Please answer this internal package fixture." });
  assert.equal(sent.status, 202, JSON.stringify(sent.body));
  await until(async () => {
    const transcript = await request(`/api/bots/${encodeURIComponent(bot.id)}`);
    assert.equal(transcript.status, 200);
    return JSON.stringify(transcript.body).includes(reply);
  }, "the packaged agent's completed response", 60_000);
  const unauthenticated = await fetch(new URL("/api/auth/stream-ticket", target.url), { method: "POST", signal: AbortSignal.timeout(5_000) });
  assert([401, 403].includes(unauthenticated.status), "An external process must not inherit the renderer's mutation capability");
  assert.equal(createHash("sha256").update(readFileSync(sentinel)).digest("hex"), sentinelHash);
  assert(existsSync(path.join(data, "bots.json")), "The fixture must persist StartupBot's data");
  assert(existsSync(path.join(profile, "last-run-version.json")), "The explicit Electron profile must be used");
  assert(existsSync(path.join(profile, "credentials.bin")), "The OS-backed credential file must stay in the isolated profile");
  if (mac) {
    const id = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
    assert.equal(id, "ai.startupbot.desktop");
  }
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "startupbot-packaged.png"), Buffer.from(screenshot.data, "base64"));
  report = { ...report, status: "PASS", health: health.body, edition: edition.body, title, agentChat: "PASS (isolated fake engine, no paid model)",
    dataIsolation: "PASS", rendererMutationBoundary: "PASS", capabilities,
    computerUse: "Permission status observed; real user-desktop control NOT RUN", liveProvider: "NOT RUN" };
  await cdp("Browser.close").catch(() => {});
} catch (error) {
  report.error = error.stack;
  throw error;
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await until(() => child.exitCode !== null || child.signalCode !== null, "application shutdown", 15_000).catch(() => child.kill("SIGKILL"));
  writeFileSync(path.join(evidence, "desktop-smoke.json"), JSON.stringify(report, null, 2) + "\n");
  const appLog = path.join(profile, "logs", "server.log");
  writeFileSync(launchLog, output + (existsSync(appLog) ? `\n${readFileSync(appLog, "utf8")}` : ""));
  rmSync(fixture, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
}
console.log(JSON.stringify(report, null, 2));
