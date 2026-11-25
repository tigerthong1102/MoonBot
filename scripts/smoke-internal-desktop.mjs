import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { desktopSmokeNetwork } from "./desktop-smoke-network.mjs";
import { smokeDesktopRestart, waitPortClosed } from "./smoke-desktop-restart.mjs";
import { smokeGroupUsernames } from "./smoke-group-usernames.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { app: { type: "string" }, output: { type: "string" }, "create-upgrade-fixture": { type: "string" } } });
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
for (const [family, notice] of [["geist", "Geist"], ["geist-mono", "Geist-Mono"], ["inter", "Inter"]]) {
  const original = readFileSync(path.join(root, "node_modules", "@fontsource-variable", family, "LICENSE"));
  assert.deepEqual(readFileSync(path.join(resources, "licenses", `${notice}-OFL.txt`)), original, `Font notice mismatch: ${family}`);
}
if (mac) {
  const info = path.join(app, "Contents", "Info.plist");
  const identity = Object.fromEntries(["CFBundleIdentifier", "CFBundleName", "CFBundleDisplayName"].map(key =>
    [key, execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, info], { encoding: "utf8" }).trim()]));
  assert.equal(identity.CFBundleIdentifier, "ai.startupbot.desktop");
  assert.equal(identity.CFBundleName, "StartupBot");
  assert.equal(identity.CFBundleDisplayName, "StartupBot");
  execFileSync("codesign", ["--verify", "--strict", app], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(path.join(evidence, "macos-identity.json"), JSON.stringify({ ...identity, signatureVerified: true, privacyPermissionGrant: "NOT RUN" }, null, 2));
}
assert.deepEqual(
  readFileSync(path.join(resources, "licenses", "cua-driver-LICENSE.txt")),
  readFileSync(path.join(root, "third_party", "cua-driver", "LICENSE.md")),
  "The installed Cua Driver notice must match the pinned upstream license",
);
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
const plan = path.join(fixture, "chat-plan.json");
const workMessage = "Tôi cần theo dõi tin tuc AI hang ngay, cap nhat lien tuc cho toi nhe";
const workName = "Tin tức AI";
const textRoutes = path.join(fixture, "work-topic.json");
const prompts = path.join(fixture, "provider-prompts.jsonl");
writeFileSync(textRoutes, JSON.stringify({ [workMessage]: JSON.stringify({ name: workName, icon: "calendar" }) }));
writeFileSync(plan, "{}");
const artifactName = "synthetic result Việt 4102.md";
const artifactText = "Synthetic artifact result 4102";
const reply = "StartupBot packaged agent fixture answered successfully";
writeFileSync(path.join(data, "config.json"), JSON.stringify({ language: "en", profile: { name: "Fixture Owner" }, features: { smartSetupChoices: false }, instances: {
  claude: { driver: "claudeAgent", displayName: "Internal package fixture", config: { cli: path.join(root, "server", "testing", "fake-claude-cli.ts") },
    environment: { FAKE_CLAUDE_ROOM_PLAN: plan, FAKE_CLAUDE_TEXT_ROUTES: textRoutes, FAKE_CLAUDE_PROMPTS: prompts } },
} }));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function freePortExcept(used) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await freePort();
    if (!used.includes(port)) return port;
  }
  throw new Error("Could not allocate distinct synthetic test ports");
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
const webhook = await freePortExcept([port]);
const debug = await freePortExcept([port, webhook]);
const env = { PATH: process.env.PATH, HOME: mac ? process.env.HOME : home, USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
  OMB_COMPANION_DIR: path.join(fixture, "phones"), OMB_COMPANION_BONJOUR: "0", OMB_DATA_DIR: data, OMB_SMOKE_HOME: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(webhook),
  OMB_SMOKE_TEST: "1", OMB_SMOKE_KEEP_OPEN: "1", OMB_SMOKE_CUA: "0",
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {}),
  ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}),
};
const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, "--remote-debugging-address=127.0.0.1", "--no-first-run"];
const netLog = path.join(fixture, "chromium-netlog.json");
if (mac) args.push(`--log-net-log=${netLog}`);
const child = spawn(executable, args, { cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
const launchLog = path.join(evidence, "desktop-smoke.log");
writeFileSync(launchLog, "");
child.stdout.on("data", bytes => { output += bytes; appendFileSync(launchLog, bytes); });
child.stderr.on("data", bytes => { output += bytes; appendFileSync(launchLog, bytes); });
child.on("error", error => { output += `\n${error.stack}\n`; });
let socket;
const rendererErrors = [];
let computerPanelVisible = false;
let stoppedGateToRelease;
let reconnectGateToRelease;
let interceptionEnabled = false;
let captureFailure = async () => {};
let restoreNetwork = async () => {};
const restartLifecycle = { started: false, stopped: false };
let report = { platform: process.platform, arch: process.arch, app, status: "FAIL" };
try {
  const target = await until(async () => {
    if (child.exitCode !== null) throw new Error(`Application exited with ${child.exitCode}`);
    const list = await fetch(`http://127.0.0.1:${debug}/json/list`, { signal: AbortSignal.timeout(2_000) }).then(r => r.json());
    return list.find(item => item.type === "page" && item.url === `http://127.0.0.1:${port}/`);
  }, "the packaged renderer");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const eventStreams = new Map();
  const pausedStreams = [];
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") rendererErrors.push({ kind: "exception", detail: message.params?.exceptionDetails?.text ?? "unknown" });
    if (message.method === "Inspector.targetCrashed") rendererErrors.push({ kind: "renderer-crash" });
    if (message.method === "Network.requestWillBeSent") {
      const url = new URL(message.params.request.url);
      if (url.origin === `http://127.0.0.1:${port}` && url.pathname === "/api/events" && url.searchParams.get("window") === "1" && url.searchParams.get("frames") === "thread") eventStreams.set(message.params.requestId, { opened: false, closed: false, failed: false, frames: 0, hello: false });
    }
    if (message.method === "Fetch.requestPaused") {
      const url = new URL(message.params.request.url);
      if (url.origin === `http://127.0.0.1:${port}` && url.pathname === "/api/events" && url.searchParams.get("window") === "1" && url.searchParams.get("frames") === "thread") pausedStreams.push({ id: message.params.requestId, networkId: message.params.networkId });
    }
    const stream = eventStreams.get(message.params?.requestId);
    if (stream && message.method === "Network.responseReceived" && message.params.response?.status === 200 && message.params.response?.mimeType === "text/event-stream") stream.opened = true;
    if (stream && (message.method === "Network.loadingFailed" || message.method === "Network.loadingFinished")) stream.closed = true;
    if (stream && message.method === "Network.loadingFailed") stream.failed = true;
    if (stream && message.method === "Network.eventSourceMessageReceived") {
      stream.frames += 1;
      try { if (JSON.parse(message.params.data)?.kind === "hello") stream.hello = true; } catch {}
    }
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
  restoreNetwork = () => cdp("Fetch.disable");
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  captureFailure = async () => {
    const snapshot = await evaluate(`({text: document.body.innerText, welcome: document.querySelector('[data-welcome]')?.getAttribute('data-welcome'), buttons: Array.from(document.querySelectorAll('[data-welcome] button')).map(button => ({text: button.innerText, disabled: button.disabled, signIn: button.getAttribute('data-sign-in')}))})`);
    writeFileSync(path.join(evidence, "desktop-failure.json"), JSON.stringify(snapshot, null, 2) + "\n");
    if (!computerPanelVisible) {
      const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(evidence, "desktop-failure.png"), Buffer.from(screenshot.data, "base64"));
    }
  };
  await cdp("Runtime.enable");
  await cdp("Inspector.enable");
  await cdp("Network.enable");
  await until(() => evaluate("Boolean(window.ogb?.getCapabilities && document.readyState === 'complete')"), "the preload bridge");
  const request = (route, body, method = "POST") => evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route)},${JSON.stringify(body === undefined ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })});return {status:r.status,body:await r.json()};})()`);
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  const edition = await request("/api/edition");
  assert.equal(edition.status, 200); assert.equal(edition.body.edition, "oss");
  const title = await evaluate("document.title");
  assert.match(title, /StartupBot/);
  const capabilities = await evaluate("window.ogb.getCapabilities()");
  const catalog = await request("/api/instances");
  assert.equal(catalog.status, 200); assert(JSON.stringify(catalog.body).includes("Internal package fixture"));
  await until(() => evaluate("Boolean(document.querySelector('[data-welcome=meet]'))"), "the first-run welcome");
  assert.doesNotMatch(await evaluate("document.body.innerText"), /\b(?:OpenMausBot|MausBot)\b/);
  await until(() => evaluate(`(() => { const next = document.querySelector('[data-welcome=meet] [data-primary]:not([data-sign-in]):not([disabled])'); if (!next) return false; next.click(); return true; })()`), "the connected fixture's Next action");
  await until(() => evaluate(`(() => {
    const button = document.querySelector('[data-chief-create]:not([disabled])');
    return button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })) === true;
  })()`), "the StartupBot helper introduction to accept Create");
  await until(() => evaluate("!document.querySelector('[data-welcome], [data-chief-intro]') && Boolean(document.querySelector('[data-startupbot-avatar]'))"), "the StartupBot chat and branded helper avatar");
  const helperText = await evaluate("document.body.innerText");
  assert.match(helperText, /StartupBot/);
  assert.doesNotMatch(helperText, /\b(?:OpenMausBot|MausBot)\b/);
  const helperScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "startupbot-helper.png"), Buffer.from(helperScreenshot.data, "base64"));
  const composer = `[...document.querySelectorAll("textarea")].findLast(input => input.getClientRects().length && !input.disabled)`;
  const send = async (text, doubleEnter = false) => {
    await until(() => evaluate(`Boolean(${composer})`), "an enabled chat composer");
    await evaluate(`(${composer}).focus()`);
    await cdp("Input.insertText", { text });
    assert.equal(await evaluate("document.activeElement.value"), text);
    const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyDown" });
    await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyUp" });
    if (doubleEnter) {
      await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyDown" });
      await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyUp" });
    }
  };
  const roster = async () => {
    const result = await request("/api/bots?messages=0");
    assert.equal(result.status, 200);
    return result.body.bots;
  };
  const disposableDesktop = process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted";
  if (disposableDesktop) {
    await until(() => evaluate("Boolean(document.querySelector('[data-tour=computer]'))"), "the computer panel entry");
    computerPanelVisible = true;
    await evaluate("document.querySelector('[data-tour=computer]').click()");
    await until(() => evaluate("Boolean(document.querySelector('[data-computer-panel-close]'))"), "the computer panel");
    await evaluate("document.querySelector('[data-computer-panel-close]').click()");
    await until(() => evaluate("!document.querySelector('[data-computer-panel-close]')"), "the computer panel to close");
    computerPanelVisible = false;
  }
  const initialBots = await roster();
  const helper = initialBots.find(row => row.defaultBot);
  assert(helper?.threadId, "The first-run main helper must exist");
  assert.equal((await request(`/api/bots/${helper.id}`, { approvalMode: "full", cwd: home }, "PATCH")).status, 200);
  assert.equal((await roster()).find(row => row.id === helper.id)?.cwd, home);
  await until(() => evaluate("Boolean(document.querySelector('[data-sidebar-account]')?.closest('button'))"), "the account menu entry");
  await evaluate("document.querySelector('[data-sidebar-account]').closest('button').click()");
  await until(() => evaluate("Boolean(document.querySelector('[data-menu-key=settings]'))"), "the Settings menu item");
  await evaluate("document.querySelector('[data-menu-key=settings]').click()");
  await until(() => evaluate("Boolean(document.querySelector('[data-settings-sheet] [data-settings-page=appearance]'))"), "Settings navigation");
  await evaluate("document.querySelector('[data-settings-sheet] [data-settings-page=appearance]').click()");
  const lightRadio = `[...document.querySelectorAll('[data-settings-sheet] [role=radio]')].find(button => button.textContent.trim() === "Light")`;
  await until(() => evaluate(`Boolean(${lightRadio})`), "the light appearance choice");
  await evaluate(`(${lightRadio}).click()`);
  await until(() => evaluate("localStorage.getItem('omb-skin') === 'daylight' && document.documentElement.dataset.skin === 'daylight'"), "the chosen light appearance");
  await evaluate("document.querySelector('[data-settings-sheet] [data-settings-page=app]').click()");
  const notificationSwitch = `document.querySelector('[data-settings-sheet] [aria-label="Show the notification feed"]')`;
  await until(() => evaluate(`Boolean(${notificationSwitch})`), "the notification feed preference");
  await evaluate(`if ((${notificationSwitch}).getAttribute('aria-checked') !== 'true') (${notificationSwitch}).click()`);
  await until(() => evaluate(`(${notificationSwitch}).getAttribute('aria-checked') === 'true'`), "the enabled synthetic notification feed");
  await evaluate("document.querySelector('[data-settings-sheet] button[aria-label=\"Close settings\"]').click()");
  await until(() => evaluate("!document.querySelector('[data-settings-sheet]')"), "Settings to close");
  const configuredHelper = (await roster()).find(row => row.id === helper.id);
  assert.equal(configuredHelper?.approvalMode, "full");
  assert.equal(configuredHelper?.cwd, home);
  await until(() => evaluate("Boolean(document.querySelector('[data-notification-bell]')?.getClientRects().length)"), "the notification feed entry");
  await evaluate("document.querySelector('[data-notification-bell]').click()");
  await until(() => evaluate("Boolean(document.querySelector('button[aria-label=\"Close Notifications\"]')?.getClientRects().length)"), "the notification feed panel");
  await evaluate("document.querySelector('button[aria-label=\"Close Notifications\"]').click()");
  await until(() => evaluate("!document.querySelector('button[aria-label=\"Close Notifications\"]') && document.querySelector('[data-notification-bell]')?.getAttribute('aria-pressed') === 'false'"), "the notification feed to close");
  writeFileSync(path.join(evidence, "notification-navigation-fixture.json"), JSON.stringify({ enabled: true, opened: true, closed: true }, null, 2) + "\n");
  if (values["create-upgrade-fixture"]) {
    const oldText = "Synthetic archived inventory note 4102", oldReply = "Synthetic archived result 4102";
    writeFileSync(plan, JSON.stringify({ [helper.id]: { script: [{ key: "legacy-offer", match: [workMessage], reply: "Synthetic legacy work result." }, { key: "old-message", match: [oldText], reply: oldReply }] } }));
    await until(async () => !(await roster()).find(row => row.id === helper.id)?.busy, "the baseline helper to become idle");
    const helperRow = `document.querySelector('[data-sidebar-bot-row="${helper.id}"]')`;
    await until(() => evaluate(`Boolean(${helperRow})`), "the baseline helper row");
    await evaluate(`${helperRow}.click()`);
    await send(workMessage);
    const legacyOffer = await until(async () => {
      const rows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
      const source = rows.find(row => row.role === "user" && row.text === workMessage);
      const offer = rows.find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === source?.id && !row.card.answered);
      return source && offer && rows.some(row => row.role === "bot" && row.text === "Synthetic legacy work result.") && { requestId: offer.card.requestId, messageId: source.id };
    }, "the baseline pending offer and completed original work");
    assert(!(await roster()).find(row => row.id === helper.id)?.busy);
    await send(oldText);
    const oldMessage = await until(async () => {
      const rows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
      const sources = rows.filter(row => row.role === "user" && row.text === oldText), source = sources[0];
      return sources.length === 1 && source?.requestPending === false && rows.some(row => row.role === "bot" && row.text === oldReply && row.turnTerminal && row.turnSucceeded && row.requestMessageId === source.id) && source;
    }, "the baseline message and reply");
    const routine = await request("/api/routines", { name: "Synthetic paused reminder", prompt: "Fixture only", botId: helper.id, enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    assert.equal(routine.status, 201, JSON.stringify(routine.body));
    assert.equal(routine.body.routine.enabled, false);
    writeFileSync(path.join(home, "synthetic-old-file.txt"), "baseline fixture file");
    assert.deepEqual(rendererErrors, [], "The baseline renderer reported an uncaught exception or crash");
    if (mac) { socket.close(); child.kill("SIGTERM"); }
    else await cdp("Browser.close").catch(() => {});
    await until(() => child.exitCode !== null || child.signalCode !== null, "the baseline application shutdown", 45_000);
    await waitPortClosed(port, "the baseline server shutdown");
    assert.deepEqual(rendererErrors, [], "The baseline renderer reported an uncaught exception or crash");
    const destination = path.resolve(values["create-upgrade-fixture"]);
    mkdirSync(destination);
    try {
      for (const entry of readdirSync(fixture)) cpSync(path.join(fixture, entry), path.join(destination, entry), { recursive: true, errorOnExist: true, force: false });
      writeFileSync(path.join(destination, "expected.json"), JSON.stringify({ botId: helper.id, threadId: helper.threadId, oldText, oldReply, messageId: oldMessage.id, routineId: routine.body.routine.id, expectedSkin: "daylight", expectedWorkspace: "home", stablePort: port, legacyOffer }));
    } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
    report = { ...report, status: "PASS", baselineFixture: destination };
  } else {
  assert(!initialBots.some(row => row.name === workName));
  const extra = "Chỉ chọn nguồn đáng tin cậy.";
  const extraNext = "Tóm tắt ngắn gọn bằng tiếng Việt.";
  const declinedWork = "Theo dõi lịch bảo trì thiết bị thử mỗi tháng.";
  writeFileSync(textRoutes, JSON.stringify({ [workMessage]: JSON.stringify({ name: workName, icon: "calendar" }), [declinedWork]: JSON.stringify({ name: "Bảo trì", icon: "calendar" }) }));
  writeFileSync(plan, JSON.stringify({ [helper.id]: { script: [
    { key: "first-work", match: [workMessage], reply: "Tôi sẽ giúp theo dõi tin tức AI." },
    { key: "queued-first", match: [extra], reply: "Đã ghi nhận ghi chú thứ nhất." },
    { key: "queued-next", match: [extraNext], reply: "Đã ghi nhận ghi chú thứ hai." },
    { key: "declined-work", match: [declinedWork], reply: "Đã ghi nhận lịch bảo trì thử." },
  ] } }));
  const helperRow = `document.querySelector('[data-sidebar-bot-row="${helper.id}"]')`;
  await until(() => evaluate(`Boolean(${helperRow})`), "the main helper in the sidebar");
  await evaluate(`${helperRow}.click()`);
  await send(workMessage, true);
  const offerCard = async () => {
    const result = await request(`/api/threads/${helper.threadId}/messages`);
    assert.equal(result.status, 200);
    return result.body.messages.find(row => row.card?.teamSetupRequest?.workBotOffer)?.card;
  };
  const offered = await until(offerCard, "the main helper to propose a dedicated bot");
  assert.equal(offered.teamSetupRequest.workBotOffer.icon, "calendar");
  assert.equal(offered.answered, undefined);
  assert(offered.title.includes(workName));
  const sourceRows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
  const sourceInputs = sourceRows.filter(row => row.role === "user" && row.text === workMessage);
  assert.equal(sourceInputs.length, 1, "Double Enter must create one source message");
  assert.equal(sourceRows.filter(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === sourceInputs[0].id).length, 1, "The source must have one offer");
  assert(!((await request("/api/bots?messages=0")).body.botQueuedMessages?.[helper.threadId] ?? []).some(row => row.text === workMessage), "Double Enter must not queue duplicate work");
  const consent = `[...document.querySelectorAll('[data-work-bot-offer] button')].find(button => button.getClientRects().length && !button.disabled && button.textContent.trim() === ${JSON.stringify(offered.options[0])})`;
  await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(offered.title)}) && Boolean(${consent})`), "the visible work question and its consent button");
  assert.deepEqual((await roster()).map(row => row.id).sort(), initialBots.map(row => row.id).sort());
  const workPrompts = () => existsSync(prompts) ? readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(workMessage)) : [];
  assert.equal(workPrompts().length, 0, "No provider run may start before the work-bot choice");
  const offerScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "work-bot-consent.png"), Buffer.from(offerScreenshot.data, "base64"));
  await until(() => evaluate(`Boolean(${composer})`), "the composer to stay usable while the suggestion is open");
  await send(extra);
  await until(async () => ((await request("/api/bots?messages=0")).body.botQueuedMessages?.[helper.threadId] ?? []).some(row => row.text === extra), "a second message to be queued with the offer pending");
  await send(extraNext);
  await until(async () => {
    const queued = (await request("/api/bots?messages=0")).body.botQueuedMessages?.[helper.threadId] ?? [];
    return queued.some(row => row.text === extra) && queued.some(row => row.text === extraNext);
  }, "both follow-up messages to remain queued before consent");
  assert.equal((await roster()).length, initialBots.length);
  await evaluate(`(() => { const button = ${consent}; button.click(); button.click(); })()`);
  const accepted = await until(async () => {
    const card = await offerCard();
    return card?.teamSetupRequest.result?.state === "applied" && card.teamSetupRequest.result;
  }, "the accepted work-bot creation receipt");
  const afterConsent = await roster();
  const newBots = afterConsent.filter(row => !initialBots.some(previous => previous.id === row.id));
  assert.equal(afterConsent.length, initialBots.length + 1);
  assert.equal(newBots.length, 1);
  const workBot = newBots[0];
  assert.equal(workBot.name, workName);
  assert.equal(accepted.bots[0].id, workBot.id);
  await until(async () => (await request(`/api/threads/${workBot.threadId}/messages`)).body.messages.some(row => row.role === "user" && row.text === workMessage), "the original request in the new bot");
  await until(() => evaluate(`document.querySelector('[data-sidebar-bot-row="${workBot.id}"]')?.getAttribute('aria-current') === 'page'`), "automatic navigation to the new bot");
  await until(() => workPrompts().length === 1, "exactly one provider run for the handed-off work");
  await until(async () => {
    const rows = (await request(`/api/threads/${workBot.threadId}/messages`)).body.messages;
    const bot = (await roster()).find(row => row.id === workBot.id);
    const userIndex = rows.findIndex(row => row.role === "user" && row.text === workMessage);
    return userIndex >= 0 && rows.slice(userIndex + 1).some(row => row.role === "bot" && row.kind === "text") && bot && !bot.busy;
  }, "the handed-off work to finish");
  const completedRequest = async (threadId, text) => {
    const rows = (await request(`/api/threads/${threadId}/messages`)).body.messages;
    const inputs = rows.filter(row => row.role === "user" && row.text === text);
    if (inputs.length !== 1 || inputs[0].requestPending !== false) return false;
    const terminal = rows.find(row => row.role === "bot" && row.turnTerminal && row.turnSucceeded && row.requestMessageId === inputs[0].id);
    return terminal?.turnId ? { requestId: inputs[0].id, turnId: terminal.turnId } : false;
  };
  const workCompletion = await until(() => completedRequest(workBot.threadId, workMessage), "the handed-off request to settle by ID");
  const transferred = await until(async () => {
    const rows = (await request(`/api/threads/${workBot.threadId}/messages`)).body.messages;
    const first = rows.find(row => row.role === "user" && row.text === extra);
    const second = rows.find(row => row.role === "user" && row.text === extraNext);
    return first && second && !first.workBotRecoveryPending && !second.workBotRecoveryPending && [first, second];
  }, "both queued clarifications to settle with the handed-off request");
  assert.notEqual(transferred[0].id, transferred[1].id);
  const transferredClarifications = transferred.map(row => ({ messageId: row.id, includedInSinglePrompt: true }));
  assert(!(await request(`/api/threads/${helper.threadId}/messages`)).body.messages.some(row => row.text === extra || row.text === extraNext));
  assert(JSON.stringify(workPrompts()[0]).includes(extra) && JSON.stringify(workPrompts()[0]).includes(extraNext));
  writeFileSync(path.join(evidence, "work-bot-prompt-fixture.json"), JSON.stringify(workPrompts(), null, 2) + "\n");
  assert.equal(workPrompts().length, 1);
  const finalSourceRows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
  assert.equal(finalSourceRows.filter(row => row.role === "user" && row.text === workMessage).length, 1);
  assert.equal(finalSourceRows.filter(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === sourceInputs[0].id).length, 1);
  assert(!((await request("/api/bots?messages=0")).body.botQueuedMessages?.[helper.threadId] ?? []).some(row => row.text === workMessage));
  const handedOffScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "work-bot-handoff.png"), Buffer.from(handedOffScreenshot.data, "base64"));
  assert(!readFileSync(path.join(data, "bots", workBot.id, "SOUL.md"), "utf8").includes(workMessage));
  assert(!workBot.description.includes(workMessage));
  assert.match(workBot.avatarUrl, /^\/api\/attachments\/[^/]+\.png$/);
  assert.deepEqual(await evaluate(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(workBot.avatarUrl)};
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  })()`), [128, 128]);
  await evaluate(`${helperRow}.click()`);
  await send(declinedWork);
  const declined = await until(async () => {
    const rows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
    const source = rows.find(row => row.role === "user" && row.text === declinedWork);
    if (!source) return false;
    return rows.map(row => row.card).find(card => card?.teamSetupRequest?.workBotOffer?.sourceMessageId === source.id && !card.answered);
  }, "a second offer for continuing in the main conversation");
  const declinedPrompts = () => readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(declinedWork));
  assert.equal(declinedPrompts().length, 0);
  const continueHere = `[...document.querySelectorAll('[data-work-bot-offer]')].find(card => card.innerText.includes(${JSON.stringify(declined.title)}))?.querySelectorAll('button')[1]`;
  await until(() => evaluate(`Boolean(${continueHere})`), "the visible continue-here choice");
  await evaluate(`(${continueHere}).click()`);
  await until(async () => (await request(`/api/threads/${helper.threadId}/messages`)).body.messages.some(row => row.card?.requestId === declined.requestId && row.card.teamSetupRequest?.result?.state === "denied"), "the declined choice to be recorded");
  const declinedCompletion = await until(() => completedRequest(helper.threadId, declinedWork), "the declined request to finish in the main conversation");
  assert.deepEqual((await roster()).map(row => row.id).sort(), afterConsent.map(row => row.id).sort());
  assert.equal(declinedPrompts().length, 1);
  await until(async () => !(await roster()).find(row => row.id === helper.id)?.busy, "the main helper to become idle before compaction");
  const compacted = await request(`/api/bots/${helper.id}/compact`, { threadId: helper.threadId });
  assert(compacted.status >= 200 && compacted.status < 300, "The synthetic conversation must allow compaction");
  await until(async () => (await request(`/api/threads/${helper.threadId}/messages`)).body.messages.some(row => row.kind === "compaction" && row.compaction?.by === "person" && !row.compaction.fresh), "the synthetic conversation summary");
  await until(async () => !(await roster()).find(row => row.id === helper.id)?.busy, "compaction to settle");
  const blockedWork = "Theo dõi kết quả kiểm kho thử mỗi tuần.";
  writeFileSync(textRoutes, JSON.stringify({ [blockedWork]: JSON.stringify({ name: "Kiểm kho", icon: "calendar" }) }));
  const blockedPlan = JSON.parse(readFileSync(plan, "utf8"));
  blockedPlan[helper.id].script.push({ key: "blocked-work", match: [blockedWork], reply: "Đã ghi nhận kiểm kho thử." });
  writeFileSync(plan, JSON.stringify(blockedPlan));
  await send(blockedWork);
  const blocked = await until(async () => {
    const rows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
    const source = rows.find(row => row.role === "user" && row.text === blockedWork);
    const card = source && rows.map(row => row.card).find(value => value?.teamSetupRequest?.workBotOffer?.sourceMessageId === source.id && value.teamSetupRequest.workBotOffer.contextBlock === "data");
    return card && { card, sourceId: source.id };
  }, "the blocked offer for compacted context");
  const blockedSection = `[...document.querySelectorAll('[data-work-bot-offer]')].find(card => card.innerText.includes(${JSON.stringify(blocked.card.title)}))`;
  const contextExplanations = readdirSync(path.join(root, "src", "locales")).filter(name => name.endsWith(".json")).flatMap(name => {
    const message = JSON.parse(readFileSync(path.join(root, "src", "locales", name), "utf8"))["server.workBot.dataUnavailable"];
    return typeof message === "string" && message.trim() ? [message.trim()] : [];
  });
  assert(contextExplanations.length > 0, "The context warning must have a translation");
  await until(() => evaluate(`(() => { const cards = [...document.querySelectorAll('[data-work-bot-offer]')].filter(card => card.innerText.includes(${JSON.stringify(blocked.card.title)})); const status = cards[0]?.querySelector('[role="status"]'); return cards.length === 1 && Boolean(status?.getClientRects().length && ${JSON.stringify(contextExplanations)}.includes(status.textContent.trim()) && getComputedStyle(status).visibility !== 'hidden'); })()`), "the visible explanation for unavailable context");
  assert.equal(await evaluate(`(${blockedSection}).querySelectorAll('button').length`), 1, "A blocked offer must only allow continuing in the original conversation");
  writeFileSync(path.join(evidence, "compacted-work-bot-offer.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const refusal = await request(`/api/threads/${helper.threadId}/respond`, { requestId: blocked.card.requestId, behavior: "allow" });
  assert.equal(refusal.status, 409, "A blocked handoff must not create a bot");
  await evaluate(`(${blockedSection}).querySelector('button').click()`);
  const blockedCompletion = await until(() => completedRequest(helper.threadId, blockedWork), "the blocked work to finish in its original conversation");
  assert.equal(blockedCompletion.requestId, blocked.sourceId);
  await until(async () => !(await roster()).find(row => row.id === helper.id)?.busy, "the source helper to become idle after blocked work");
  assert(!((await request("/api/bots?messages=0")).body.botQueuedMessages?.[helper.threadId] ?? []).some(row => row.text === blockedWork), "No blocked work may remain queued");
  await new Promise(resolve => setTimeout(resolve, 1_000));
  const settledRows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
  assert.equal(settledRows.find(row => row.card?.requestId === blocked.card.requestId)?.card?.teamSetupRequest?.result?.state, "denied");
  assert(!((await request("/api/bots?messages=0")).body.botQueuedMessages?.[helper.threadId] ?? []).some(row => row.text === blockedWork), "Blocked work must remain out of the queue");
  assert.deepEqual((await roster()).map(row => row.id).sort(), afterConsent.map(row => row.id).sort());
  const blockedPrompts = readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(blockedWork));
  assert.equal(blockedPrompts.length, 1, "Blocked work must run once in the original conversation");
  assert(JSON.stringify(blockedPrompts[0]).includes("Earlier conversation summary"), "The original provider must receive the saved summary");
  writeFileSync(path.join(evidence, "compacted-work-bot-fixture.json"), JSON.stringify({ sourceId: blocked.sourceId, requestId: blockedCompletion.requestId, targetBotsCreated: 0, providerPrompts: 1, summaryPresent: true }) + "\n");
  const freshStart = await request(`/api/bots/${helper.id}/start-fresh`, { threadId: helper.threadId });
  assert(freshStart.status >= 200 && freshStart.status < 300, "The next independent fixture must start with fresh context");
  const created = await request("/api/bots", { name: "Internal package agent", cwd: home });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bot = created.body.bot;
  assert(bot?.id, "Bot creation did not return its identity");
  const duplicate = await request("/api/bots", { name: "Internal package agent", cwd: home });
  assert.equal(duplicate.status, 201, JSON.stringify(duplicate.body));
  assert.notEqual(duplicate.body.bot?.id, bot.id);
  await smokeGroupUsernames({ bot, evaluate, until, cdp, evidence });
  const first = "Please answer this internal package fixture.";
  assert.equal((await request("/api/sidebar-sections", { name: "Package fixture", botIds: [bot.id] })).status, 200);
  assert.equal((await request(`/api/bots/${bot.id}`, { chiefOfStaff: true, approvalMode: "full" }, "PATCH")).status, 200);
  const specialist = "Trợ lý dữ liệu thử";
  const create = `Tạo một bot tên “${specialist}” để kiểm tra tệp dữ liệu thử.`;
  const newTitle = "Đối soát thử";
  const rename = `Đổi tên hội thoại này thành “${newTitle}”.`;
  const clear = "Xóa tin nhắn của đúng hội thoại này";
  const followup = "Continue the fixture conversation.";
  const stopText = "Hold the synthetic turn for cancellation";
  const stopReady = path.join(fixture, "stop-ready"), stopGate = path.join(fixture, "stop-gate"), stopContinued = path.join(fixture, "stop-continued");
  const postStop = "Check the synthetic conversation after stop";
  const reconnectText = "Hold the synthetic turn while reconnecting";
  const reconnectReady = path.join(fixture, "reconnect-ready"), reconnectGate = path.join(fixture, "reconnect-gate"), reconnectDone = path.join(fixture, "reconnect-done");
  reconnectGateToRelease = reconnectGate;
  stoppedGateToRelease = stopGate;
  writeFileSync(plan, JSON.stringify({ [bot.id]: { script: [
    { key: "first", match: [first], reply },
    { key: "create", match: [create], steps: [
      { tool: "find_tool", arguments: { query: create }, capture: { selected: '"matches":\\[\\{"name":"([^"]+)"' } },
      { tool: "use_tool", arguments: { name: "{{selected}}", arguments: { name: specialist, role: "Kiểm tra dữ liệu", instructions: "Kiểm tra tệp dữ liệu thử khi được giao." } } },
    ], reply: "Đã tạo bot thử." },
    { key: "rename", match: [rename], steps: [{ tool: "rename_thread", arguments: { title: newTitle } }], reply: "Đã đổi tên hội thoại thử." },
    { key: "clear", match: [clear], steps: [{ tool: "app_settings", arguments: { action: "show_card", card: "clear-messages" } }], reply: "Confirm in chat." },
    { key: "followup", match: [followup], reply: "Fresh fixture reply." },
    { key: "stop", match: [stopText], readyFile: stopReady, gateFile: stopGate, afterGateFile: stopContinued, progressAfterGate: "CANCELED_GATE_RELEASED", reply: "Canceled fixture should not finish." },
    { key: "post-stop", match: [postStop], reply: "Synthetic conversation remains usable." },
    { key: "reconnect", match: [reconnectText], readyFile: reconnectReady, gateFile: reconnectGate, afterGateFile: reconnectDone, reply: "Synthetic reconnect turn finished." },
  ] } }));
  const sent = await request(`/api/bots/${encodeURIComponent(bot.id)}/messages`, { text: first });
  assert.equal(sent.status, 202, JSON.stringify(sent.body));
  await until(async () => {
    const transcript = await request(`/api/bots/${encodeURIComponent(bot.id)}`);
    assert.equal(transcript.status, 200);
    return JSON.stringify(transcript.body).includes("StartupBot packaged agent fixture answered successfully");
  }, "the packaged agent's completed response", 60_000);
  const transcript = async () => {
    const result = await request(`/api/threads/${encodeURIComponent(bot.threadId)}/messages`);
    assert.equal(result.status, 200);
    return result.body.messages;
  };
  const workspaceFile = path.join(home, "fixture-report.txt");
  writeFileSync(workspaceFile, "synthetic report");
  const selectBot = `document.querySelector('[data-sidebar-bot-row="${bot.id}"]')`;
  await until(() => evaluate(`Boolean(${selectBot})`), "the fixture bot in the sidebar");
  await evaluate(`${selectBot}.click()`);
  await until(() => evaluate(`${selectBot}?.getAttribute('aria-current') === 'page'`), "the fixture conversation");
  await until(() => completedRequest(bot.threadId, first), "the first fixture request to complete");
  const artifactWorkspace = await until(async () => (await roster()).find(row => row.id === bot.id)?.tasks?.find(task => task.threadId === bot.threadId)?.cwd, "the fixture conversation workspace");
  assert(path.isAbsolute(artifactWorkspace), "The fixture conversation must have an absolute workspace");
  const workspaceRelative = path.relative(realpathSync(fixture), realpathSync(artifactWorkspace));
  assert(workspaceRelative && workspaceRelative !== ".." && !workspaceRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(workspaceRelative), "The artifact workspace must stay inside the fixture");
  const artifactPath = path.join(artifactWorkspace, artifactName);
  const artifactTask = "Create a synthetic result for preview";
  const artifactReplyText = `Synthetic result ready.\n\n[Open synthetic result](${pathToFileURL(artifactPath).href})`;
  const updatedPlan = JSON.parse(readFileSync(plan, "utf8"));
  updatedPlan[bot.id].script.push({ key: "artifact", match: [artifactTask], fixtureArtifactFile: artifactPath, fixtureArtifactText: artifactText, reply: artifactReplyText });
  writeFileSync(plan, JSON.stringify(updatedPlan));
  await send(artifactTask);
  const artifactCompletion = await until(() => completedRequest(bot.threadId, artifactTask), "the artifact request to complete");
  const artifactRows = (await request(`/api/threads/${bot.threadId}/messages`)).body.messages;
  const artifactReply = artifactRows.find(row => row.role === "bot" && row.requestMessageId === artifactCompletion.requestId && row.text === artifactReplyText);
  assert(artifactReply?.id, "The artifact must belong to the completed fixture request");
  const artifactOwner = `document.querySelector('[data-citation-owner="${bot.id}"][data-citation-thread="${bot.threadId}"][data-citation-source="${artifactReply.id}"]')`;
  const artifactButton = `[...(${artifactOwner})?.querySelectorAll('button') ?? []].find(button => button.getClientRects().length && button.textContent.trim() === "Open synthetic result")`;
  await until(() => evaluate(`Boolean(${artifactButton})`), "the synthetic result link in its source message");
  assert.equal(readFileSync(artifactPath, "utf8"), artifactText);
  await evaluate(`(${artifactButton}).click()`);
  await until(() => evaluate(`document.querySelector('[data-markdown-file]')?.innerText.includes(${JSON.stringify(artifactText)})`), "the synthetic result preview");
  await evaluate("document.querySelector('dialog:has([data-markdown-file]) button[aria-label=\"Close table\"]').click()");
  await until(() => evaluate("!document.querySelector('[data-markdown-file]')"), "the synthetic result preview to close");
  writeFileSync(path.join(evidence, "artifact-fixture.json"), JSON.stringify({ botId: bot.id, threadId: bot.threadId, requestId: artifactCompletion.requestId, messageId: artifactReply.id, name: artifactName, opened: true }, null, 2) + "\n");
  const readBot = async () => (await request("/api/bots?messages=0")).body.bots.find(row => row.id === bot.id);
  const finished = async text => (await transcript()).some(row => row.role === "bot" && row.text === text) && !(await readBot()).busy;
  await send(rename);
  await until(() => finished("Đã đổi tên hội thoại thử."), "the rename turn to finish");
  assert.equal((await readBot()).tasks.find(task => task.threadId === bot.threadId)?.title, newTitle);
  const bridge = async enabled => assert.equal((await request("/api/config", { features: { agentsToolBridge: enabled } }, "PATCH")).status, 200);
  await bridge(true);
  await send(create);
  await until(() => finished("Đã tạo bot thử."), "the discovered create action to finish");
  const specialists = (await request("/api/bots?messages=0")).body.bots.filter(row => row.name === specialist);
  assert.equal(specialists.length, 1);
  assert.notEqual(specialists[0].id, bot.id);
  await bridge(false);
  await send(clear);
  const confirm = `[...document.querySelectorAll('[data-settings-card="clear-messages"] button')].find(button => button.textContent.trim() === "Delete messages")`;
  await until(() => evaluate(`Boolean(${confirm} && !(${confirm}).disabled)`), "an enabled clear-messages confirmation");
  assert((await transcript()).some(row => row.text === first));
  const cardScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "clear-messages-confirm.png"), Buffer.from(cardScreenshot.data, "base64"));
  await evaluate(`(${confirm}).click()`);
  await until(async () => (await transcript()).length === 0, "the cleared transcript");
  await until(() => evaluate(`!document.querySelector('[data-settings-card="clear-messages"]')`), "the renderer to remove the card");
  assert.equal(readFileSync(workspaceFile, "utf8"), "synthetic report");
  await send(followup);
  await until(async () => (await transcript()).some(row => row.text === "Fresh fixture reply."), "a fresh reply in the same thread");
  assert(!(await transcript()).some(row => row.text === first));
  await send(stopText);
  await until(() => existsSync(stopReady), "the synthetic turn to be running");
  const stopSource = (await transcript()).find(row => row.role === "user" && row.text === stopText);
  assert(stopSource?.id);
  await evaluate(`${helperRow}.click()`);
  await until(() => evaluate(`${helperRow}?.getAttribute('aria-current') === 'page'`), "navigation away from the running turn");
  await evaluate(`${selectBot}.click()`);
  await until(() => evaluate(`${selectBot}?.getAttribute('aria-current') === 'page'`), "navigation back to the running turn");
  await until(() => evaluate("Boolean(document.querySelector('button[aria-label=\"Stop this turn\"]'))"), "the Stop button after navigation");
  await evaluate("document.querySelector('button[aria-label=\"Stop this turn\"]').click()");
  await until(async () => (await transcript()).find(row => row.id === stopSource.id)?.requestCancelled === true && !(await readBot()).busy, "the synthetic turn to stop");
  assert(!(await transcript()).some(row => row.text === "Canceled fixture should not finish."));
  assert.equal(readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(stopText)).length, 1);
  assert.equal((await transcript()).filter(row => row.role === "user" && row.text === stopText).length, 1);
  writeFileSync(stopGate, "release");
  await send(postStop);
  await until(() => completedRequest(bot.threadId, postStop), "a new synthetic turn to finish after Stop");
  const stoppedRows = await transcript();
  assert(stoppedRows.some(row => row.role === "bot" && row.text === "Synthetic conversation remains usable."));
  assert(!stoppedRows.some(row => row.text === "Canceled fixture should not finish." || JSON.stringify(row).includes("CANCELED_GATE_RELEASED")));
  assert(!stoppedRows.some(row => row.role === "bot" && row.turnTerminal && row.turnSucceeded && row.requestMessageId === stopSource.id));
  await new Promise(resolve => setTimeout(resolve, 1_000));
  assert.equal(existsSync(stopContinued), false, "The canceled fake provider must not continue after its gate opens");
  writeFileSync(path.join(evidence, "stop-fixture.json"), JSON.stringify({ requestId: stopSource.id, canceled: true, providerPrompts: 1, gateContinuationObserved: false, observationMs: 1000 }, null, 2) + "\n");
  const streamsBeforeReload = new Set(eventStreams.keys());
  await cdp("Page.enable");
  await evaluate("window.__fixtureReloadMarker = true");
  await cdp("Page.reload", { ignoreCache: true });
  await until(() => evaluate("Boolean(!window.__fixtureReloadMarker && window.ogb?.getCapabilities && document.readyState === 'complete')"), "the reloaded renderer");
  await until(() => evaluate(`Boolean(${selectBot})`), "the fixture bot after reload");
  await evaluate(`${selectBot}.click()`);
  await until(() => [...eventStreams.entries()].some(([id, value]) => !streamsBeforeReload.has(id) && value.opened && !value.closed && value.hello), "a live event stream with hello");
  const noticesBefore = (await request("/api/notifications")).body.notifications;
  await send(reconnectText);
  await until(() => existsSync(reconnectReady), "the reconnect fixture turn to be running");
  const reconnectSource = (await transcript()).find(row => row.role === "user" && row.text === reconnectText);
  assert(reconnectSource?.id);
  const liveStreams = [...eventStreams.entries()].filter(([id, value]) => !streamsBeforeReload.has(id) && value.opened && !value.closed && value.hello);
  assert.equal(liveStreams.length, 1, "Exactly one fixture event stream must own the renderer");
  await evaluate(`(() => {
    const original = EventSource.prototype.close;
    window.__fixtureStreamCloses = [];
    EventSource.prototype.close = function() {
      const wasOpen = this.readyState === EventSource.OPEN;
      const result = original.call(this);
      const url = new URL(this.url, window.location.href);
      if (url.origin === window.location.origin && url.pathname === "/api/events" && url.searchParams.get("window") === "1" && url.searchParams.get("frames") === "thread") window.__fixtureStreamCloses.push(wasOpen && this.readyState === EventSource.CLOSED);
      return result;
    };
  })()`);
  interceptionEnabled = true;
  await cdp("Fetch.enable", { patterns: [{ urlPattern: `http://127.0.0.1:${port}/api/events*`, requestStage: "Request" }] });
  await evaluate("window.dispatchEvent(new Event('omb:retry-live-events'))");
  await until(() => evaluate("window.__fixtureStreamCloses?.length === 1 && window.__fixtureStreamCloses[0] === true"), "the original EventSource to close");
  const openedAtDisconnect = new Set([...eventStreams.entries()].filter(([, value]) => value.opened).map(([id]) => id));
  const failedAttempt = await until(() => pausedStreams[0], "the first reconnect attempt to pause");
  assert(failedAttempt.networkId, "The failed reconnect must have a network request ID");
  await cdp("Fetch.failRequest", { requestId: failedAttempt.id, errorReason: "ConnectionReset" });
  await until(() => eventStreams.get(failedAttempt.networkId)?.failed && !eventStreams.get(failedAttempt.networkId)?.opened, "the reconnect handshake to fail");
  const replacementAttempt = await until(() => pausedStreams.find(entry => entry.id !== failedAttempt.id), "the retry attempt to pause");
  assert(replacementAttempt.networkId, "The replacement stream must have a network request ID");
  writeFileSync(reconnectGate, "release");
  await until(() => existsSync(reconnectDone), "the fake provider to pass its gate while disconnected");
  await until(() => {
    const db = new DatabaseSync(path.join(data, "messages.db"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT json FROM messages WHERE thread_id = ?").all(bot.threadId).map(row => JSON.parse(row.json));
      const source = rows.find(row => row.id === reconnectSource.id);
      const terminal = rows.filter(row => row.role === "bot" && row.turnTerminal && row.turnSucceeded && row.requestMessageId === reconnectSource.id);
      return source?.requestPending === false && terminal.length === 1;
    } finally { db.close(); }
  }, "the result to persist while the stream is disconnected");
  assert(![...eventStreams.entries()].some(([id, value]) => !openedAtDisconnect.has(id) && value.opened), "No event stream may reopen before the disconnected result is persisted");
  await cdp("Fetch.continueRequest", { requestId: replacementAttempt.id });
  await cdp("Fetch.disable");
  interceptionEnabled = false;
  await until(() => { const stream = eventStreams.get(replacementAttempt.networkId); return stream?.opened && !stream.closed && stream.hello; }, "the replacement event stream with hello");
  const reconnectCompletion = await until(() => completedRequest(bot.threadId, reconnectText), "the reconnect fixture turn to finish");
  await until(() => evaluate("document.body.innerText.includes('Synthetic reconnect turn finished.')"), "the reconnected renderer to show the result");
  assert.equal((await transcript()).filter(row => row.role === "bot" && row.turnTerminal && row.turnSucceeded && row.requestMessageId === reconnectCompletion.requestId).length, 1);
  assert.equal(readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(reconnectText)).length, 1);
  const noticesAfter = (await request("/api/notifications")).body.notifications;
  const newNotices = noticesAfter.filter(row => !noticesBefore.some(before => before.id === row.id) && row.threadId === bot.threadId);
  assert(newNotices.length <= 1, "Reconnection must not create duplicate notifications for the synthetic turn");
  writeFileSync(path.join(evidence, "reconnect-fixture.json"), JSON.stringify({ requestId: reconnectCompletion.requestId, turnId: reconnectCompletion.turnId, originalClosed: true, failedHandshake: true, resultPersistedWhileDisconnected: true, replacementHello: true, providerPrompts: 1, newServerNotifications: newNotices.length }, null, 2) + "\n");

  const approvalCases = [
    { mode: "ask", decision: "deny", topic: "Đơn hàng", text: "Theo dõi đơn hàng thử mỗi tuần." },
    { mode: "ask", decision: "allow", topic: "Chất lượng", text: "Theo dõi chất lượng thử mỗi tháng." },
    { mode: "full", decision: "full", topic: "Vận chuyển", text: "Theo dõi vận chuyển thử mỗi ngày." },
  ];
  const permissionCounts = {};
  const handoffPermissions = [];
  for (const item of approvalCases) {
    assert.equal((await request(`/api/bots/${helper.id}`, { approvalMode: item.mode, applyToAllThreads: true }, "PATCH")).status, 200);
    const before = await roster();
    assert.equal(before.find(row => row.id === helper.id)?.approvalMode, item.mode);
    writeFileSync(textRoutes, JSON.stringify({ [item.text]: JSON.stringify({ name: item.topic, icon: "calendar" }) }));
    await evaluate(`${helperRow}.click()`);
    await until(() => evaluate(`${helperRow}?.getAttribute('aria-current') === 'page'`), "the main helper before the permission handoff");
    await send(item.text);
    const offer = await until(async () => {
      const rows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
      const source = rows.find(row => row.role === "user" && row.text === item.text);
      return source && rows.map(row => row.card).find(card => card?.teamSetupRequest?.workBotOffer?.sourceMessageId === source.id && !card.answered);
    }, "the permission handoff offer for the source message");
    const targetId = offer.teamSetupRequest.operations.find(operation => operation.action === "create")?.botId;
    assert(targetId && !before.some(row => row.id === targetId));
    const counter = path.join(fixture, `permission-${item.decision}.count`);
    const command = `synthetic-permission-write-${item.decision}`;
    writeFileSync(plan, JSON.stringify({ [targetId]: { script: [{
      key: `permission-${item.decision}`, match: [item.text], approve: { tool_name: "Bash", input: { command } },
      fixturePermissionCounter: counter, reply: "Synthetic permitted action finished.", replyIfDenied: "Synthetic action denied.",
    }] } }));
    const createButton = `[...document.querySelectorAll('[data-work-bot-offer]')].find(card => card.innerText.includes(${JSON.stringify(offer.title)}))?.querySelector('button')`;
    await until(() => evaluate(`Boolean((${createButton})?.getClientRects().length) && (${createButton})?.textContent.trim() === ${JSON.stringify(offer.options[0])}`), "the consent button for this target");
    assert.equal(existsSync(counter), false);
    await evaluate(`(${createButton}).click()`);
    const subject = await until(async () => (await roster()).find(row => row.id === targetId), "the bot created by consent");
    assert.equal(subject.approvalMode, item.mode, "The new bot must inherit the main chat permission mode");
    await until(() => evaluate(`document.querySelector('[data-sidebar-bot-row="${targetId}"]')?.getAttribute('aria-current') === 'page'`), "automatic navigation to the permission handoff target");
    if (item.mode === "ask") {
      const card = `[...document.querySelectorAll('[data-ask-card=approval]')].find(card => card.getClientRects().length)`;
      await until(() => evaluate(`Boolean(${card})`), "the synthetic permission approval");
      assert.equal(existsSync(counter), false, "No fixture action may run before approval");
      const cardText = await evaluate(`(${card}).innerText`);
      assert(cardText.includes(command), "The approval must show the action being requested");
      const choice = item.decision === "allow" ? "Allow once" : "Deny";
      const button = `[...(${card}).querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(choice)})`;
      await until(() => evaluate(`Boolean(${button})`), "the requested permission decision");
      await evaluate(`(${button}).click()`);
    }
    const completion = await until(() => completedRequest(subject.threadId, item.text), "the permission fixture turn to settle");
    const count = existsSync(counter) ? readFileSync(counter, "utf8").split("\n").filter(Boolean).length : 0;
    assert.equal(count, item.decision === "deny" ? 0 : 1, `Unexpected fixture action count in ${item.decision}`);
    const rows = (await request(`/api/threads/${subject.threadId}/messages`)).body.messages;
    assert(rows.some(row => row.role === "bot" && row.requestMessageId === completion.requestId && row.text === (item.decision === "deny" ? "Synthetic action denied." : "Synthetic permitted action finished.")));
    const permissionEvidence = await until(() => {
      if (!existsSync(plan + ".evidence.jsonl")) return null;
      const entries = readFileSync(plan + ".evidence.jsonl", "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.botId === subject.id && entry.threadId === subject.threadId && entry.planKey === `permission-${item.decision}`);
      return entries.length ? entries : null;
    }, "the fake provider permission evidence");
    assert.equal(permissionEvidence.length, 1);
    assert.equal(permissionEvidence[0].approval?.behavior, item.decision === "deny" ? "deny" : "allow");
    assert.equal(permissionEvidence[0].permissionMode, item.mode === "full" ? "bypassPermissions" : "default");
    assert.equal(permissionEvidence[0].permissionPromptTool, item.mode === "ask");
    const copiedSource = rows.find(row => row.id === completion.requestId);
    assert.equal(copiedSource?.workBotHandoffSource?.messageId, offer.teamSetupRequest.workBotOffer.sourceMessageId);
    assert.equal(copiedSource.workBotHandoffSource.threadId, helper.threadId);
    assert.equal(copiedSource.workBotHandoffSource.botId, helper.id);
    permissionCounts[item.decision] = count;
    handoffPermissions.push({ mode: item.mode, decision: item.decision, sourceId: copiedSource.workBotHandoffSource.messageId, targetId, threadId: subject.threadId, requestId: completion.requestId, executions: count });
  }
  writeFileSync(path.join(evidence, "permission-fixture.json"), JSON.stringify(permissionCounts, null, 2) + "\n");
  writeFileSync(path.join(evidence, "work-bot-permissions.json"), JSON.stringify(handoffPermissions, null, 2) + "\n");
  const cancelWork = "Theo dõi tình trạng thiết bị giả hàng tuần.";
  const cancelFollowup = "Kiểm tra lại thiết bị giả sau khi dừng.";
  const cancelReady = path.join(fixture, "handoff-stop-ready"), cancelGate = path.join(fixture, "handoff-stop-gate"), cancelContinued = path.join(fixture, "handoff-stop-continued");
  stoppedGateToRelease = cancelGate;
  writeFileSync(textRoutes, JSON.stringify({ [cancelWork]: JSON.stringify({ name: "Thiết bị giả", icon: "calendar" }) }));
  await evaluate(`${helperRow}.click()`);
  await until(() => evaluate(`${helperRow}?.getAttribute('aria-current') === 'page'`), "the helper before the canceled handoff");
  await send(cancelWork);
  const cancelOffer = await until(async () => {
    const rows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
    const source = rows.find(row => row.role === "user" && row.text === cancelWork);
    const card = rows.find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === source?.id && !row.card.answered)?.card;
    return source && card && { source, card };
  }, "the cancellation fixture offer");
  const cancelBotId = cancelOffer.card.teamSetupRequest.operations.find(operation => operation.action === "create")?.botId;
  assert(cancelBotId);
  writeFileSync(plan, JSON.stringify({ [cancelBotId]: { script: [
    { key: "handoff-stop", match: [cancelWork], readyFile: cancelReady, gateFile: cancelGate, afterGateFile: cancelContinued, reply: "Canceled handoff must not finish." },
    { key: "handoff-after-stop", match: [cancelFollowup], reply: "Synthetic handoff remains usable." },
  ] } }));
  const cancelConsent = `[...document.querySelectorAll('[data-work-bot-offer]')].find(card => card.innerText.includes(${JSON.stringify(cancelOffer.card.title)}))?.querySelector('button')`;
  await until(() => evaluate(`Boolean((${cancelConsent})?.getClientRects().length)`), "the cancellation fixture consent");
  await evaluate(`(${cancelConsent}).click()`);
  const cancelBot = await until(async () => (await roster()).find(row => row.id === cancelBotId), "the canceled handoff bot");
  await until(() => evaluate(`document.querySelector('[data-sidebar-bot-row="${cancelBotId}"]')?.getAttribute('aria-current') === 'page'`), "navigation to the canceled handoff bot");
  await until(() => existsSync(cancelReady), "the handed-off turn to reach its gate");
  const cancelRows = () => request(`/api/threads/${cancelBot.threadId}/messages`).then(result => result.body.messages);
  const cancelRequest = (await cancelRows()).find(row => row.role === "user" && row.workBotHandoffSource?.messageId === cancelOffer.source.id);
  assert(cancelRequest?.id);
  const cancelStopButton = `[...document.querySelectorAll('button[aria-label="Stop this turn"]')].filter(button => button.getClientRects().length)`;
  await until(() => evaluate(`${cancelStopButton}.length === 1`), "one visible Stop button on the handed-off turn");
  await evaluate(`${cancelStopButton}[0].click()`);
  await until(async () => (await cancelRows()).find(row => row.id === cancelRequest.id)?.requestCancelled === true && !(await roster()).find(row => row.id === cancelBotId)?.busy, "the handed-off turn to stop");
  writeFileSync(cancelGate, "release");
  await new Promise(resolve => setTimeout(resolve, 1_000));
  assert.equal(existsSync(cancelContinued), false, "Stopped handoff must not continue after its gate opens");
  assert.equal(readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(cancelWork)).length, 1);
  const canceledHandoff = { sourceId: cancelOffer.source.id, targetId: cancelBotId, threadId: cancelBot.threadId, requestId: cancelRequest.id, text: cancelWork, followup: cancelFollowup, continued: cancelContinued };
  writeFileSync(path.join(evidence, "work-bot-stop.json"), JSON.stringify({ ...canceledHandoff, continued: false }, null, 2) + "\n");
  const unauthenticated = await fetch(new URL("/api/auth/stream-ticket", target.url), { method: "POST", signal: AbortSignal.timeout(5_000) });
  assert([401, 403].includes(unauthenticated.status), "An external process must not inherit the renderer's mutation capability");
  assert.equal(createHash("sha256").update(readFileSync(sentinel)).digest("hex"), sentinelHash);
  assert(existsSync(path.join(data, "bots.json")), "The fixture must persist StartupBot's data");
  assert(existsSync(path.join(profile, "last-run-version.json")), "The explicit Electron profile must be used");
  assert.equal(existsSync(path.join(profile, "credentials.bin")), false, "First launch must not provision phone credentials before pairing");
  const remoteOnly = await evaluate("window.ogb.companion.start([])");
  assert.equal(remoteOnly.enabled, true, remoteOnly.error);
  assert.deepEqual(remoteOnly.directRoutes, { wifi: false, tailscale: false });
  await evaluate("window.ogb.companion.stop()");
  if (mac) {
    const id = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
    assert.equal(id, "ai.startupbot.desktop");
  }
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "startupbot-packaged.png"), Buffer.from(screenshot.data, "base64"));
  assert.deepEqual(rendererErrors, [], "The packaged renderer reported an uncaught exception or crash");
  const botIds = (await roster()).map(row => row.id);
  assert.deepEqual(rendererErrors, [], "The packaged renderer reported an uncaught exception or crash");
  if (mac) { socket.close(); child.kill("SIGTERM"); }
  else await cdp("Browser.close").catch(() => {});
  await until(() => child.exitCode !== null || child.signalCode !== null, "the first application shutdown", 45_000);
  await waitPortClosed(port, "the first server to stop");
  assert.deepEqual(rendererErrors, [], "The packaged renderer reported an uncaught exception or crash");
  const restart = await smokeDesktopRestart({ executable, profile, fixture, env, helper, workBot, workMessage, workRequestId: workCompletion.requestId, blockedWork: { sourceId: blocked.sourceId, cardId: blocked.card.requestId, text: blockedWork }, canceledHandoff, prompts, workspaceFile, botIds, evidence, expectedSkin: "daylight", expectedWorkspace: home, stablePort: port, lifecycle: restartLifecycle });
  report = { ...report, status: "PASS", health: health.body, edition: edition.body, title, agentChat: "PASS (isolated fake engine, no paid model)",
    workBotOffer: { doubleEnter: true, doubleConsent: true, beforeConsent: 0, afterConsent: newBots.length, receiptVerified: true, taskNotCopiedIntoStandingInstructions: true, avatarDecoded: true, workCompletion, transferredClarifications, declinedCompletion, compactedContext: "PASS (blocked transfer; one source run with summary)" },
    artifactPreview: "PASS (synthetic Markdown opened from its conversation)",
    notificationNavigation: "PASS (feed enabled and opened in isolated profile)",
    permissionFixture: permissionCounts, workBotPermissions: handoffPermissions,
    reconnect: { status: "PASS", reconnectCompletion, oldStreamClosed: true, retryHandshakeFailed: true, replacementStreamOpened: true, notificationRecords: "at most one new record for fixture thread" },
    stopAfterNavigation: "PASS (synthetic turn canceled; no fake continuation observed for one second after a follow-up)",
    stopAfterHandoff: "PASS (target request canceled and checked again after restart)",
    computerPanelNavigation: disposableDesktop ? "PASS (opened and closed on disposable runner; no desktop control)" : "NOT RUN (requires disposable desktop)",
    appCommands: "PASS (direct rename and Vietnamese discovery-driven bot creation, verified actual title and roster)",
    clearMessages: "PASS (confirmed in packaged renderer; bot, thread and file retained; fresh reply)", dataIsolation: "PASS", remoteOnlyPhoneLink: "PASS", rendererMutationBoundary: "PASS", welcomeAndHelperBranding: "PASS (real packaged renderer)", capabilities,
    restart, computerUse: "Permission status observed; real user-desktop control NOT RUN", liveProvider: "NOT RUN" };
  }
} catch (error) {
  report.error = error.stack;
  await captureFailure().catch(failure => { report.diagnosticsError = failure.message; });
  throw error;
} finally {
  for (const gate of [stoppedGateToRelease, reconnectGateToRelease]) {
    try { if (gate && !existsSync(gate)) writeFileSync(gate, "cleanup"); }
    catch (error) { report.status = "FAIL"; report.cleanupGateError = error.stack; }
  }
  if (interceptionEnabled) await restoreNetwork().catch(() => {});
  socket?.close();
  let firstStopped = false;
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await until(() => child.exitCode !== null || child.signalCode !== null, "application shutdown", 15_000).catch(() => child.kill("SIGKILL"));
    await until(() => child.exitCode !== null || child.signalCode !== null, "application exit", 15_000);
    await waitPortClosed(port, "server shutdown");
    firstStopped = true;
    if (mac && report.status === "PASS") {
      const network = desktopSmokeNetwork(JSON.parse(readFileSync(netLog, "utf8")));
      writeFileSync(path.join(evidence, "chromium-network.json"), JSON.stringify(network, null, 2) + "\n");
      assert.equal(network.faviconRequests, 0, "Service badges requested an external favicon");
    }
  } catch (error) {
    report.status = "FAIL";
    report.cleanupError = error.stack;
  } finally {
    if (!firstStopped || (restartLifecycle.started && !restartLifecycle.stopped)) report.retainedFixture = fixture;
    writeFileSync(path.join(evidence, "renderer-errors.json"), JSON.stringify(rendererErrors, null, 2) + "\n");
    writeFileSync(path.join(evidence, "desktop-smoke.json"), JSON.stringify(report, null, 2) + "\n");
    const appLog = path.join(profile, "logs", "server.log");
    writeFileSync(launchLog, output + (existsSync(appLog) ? `\n${readFileSync(appLog, "utf8")}` : ""));
    if (!report.retainedFixture) rmSync(fixture, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
}
assert.equal(report.status, "PASS", report.error);
console.log(JSON.stringify(report, null, 2));
