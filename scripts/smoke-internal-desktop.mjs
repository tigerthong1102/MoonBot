import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desktopSmokeNetwork } from "./desktop-smoke-network.mjs";

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
writeFileSync(plan, "{}");
const reply = "StartupBot packaged agent fixture answered successfully";
writeFileSync(path.join(data, "config.json"), JSON.stringify({ language: "en", features: { smartSetupChoices: false }, instances: {
  claude: { driver: "claudeAgent", displayName: "Internal package fixture", config: { cli: path.join(root, "server", "testing", "fake-claude-cli.ts") },
    environment: { FAKE_CLAUDE_ROOM_PLAN: plan } },
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
let captureFailure = async () => {};
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
  captureFailure = async () => {
    const snapshot = await evaluate(`({text: document.body.innerText, welcome: document.querySelector('[data-welcome]')?.getAttribute('data-welcome'), buttons: Array.from(document.querySelectorAll('[data-welcome] button')).map(button => ({text: button.innerText, disabled: button.disabled, signIn: button.getAttribute('data-sign-in')}))})`);
    writeFileSync(path.join(evidence, "desktop-failure.json"), JSON.stringify(snapshot, null, 2) + "\n");
    const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(evidence, "desktop-failure.png"), Buffer.from(screenshot.data, "base64"));
  };
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
  const send = async text => {
    await until(() => evaluate(`Boolean(${composer})`), "an enabled chat composer");
    await evaluate(`(${composer}).focus()`);
    await cdp("Input.insertText", { text });
    assert.equal(await evaluate("document.activeElement.value"), text);
    const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyDown" });
    await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyUp" });
  };
  const roster = async () => {
    const result = await request("/api/bots?messages=0");
    assert.equal(result.status, 200);
    return result.body.bots;
  };
  const initialBots = await roster();
  const helper = initialBots.find(row => row.defaultBot);
  assert(helper?.threadId, "The first-run main helper must exist");
  assert.equal((await request(`/api/bots/${helper.id}`, { approvalMode: "full" }, "PATCH")).status, 200);
  const workMessage = "Tôi cần theo dõi tiến độ kiểm kho mỗi tuần.";
  const workName = "Kiểm kho";
  assert(!initialBots.some(row => row.name === workName));
  writeFileSync(plan, JSON.stringify({ [helper.id]: { script: [
    { key: "first-work", match: [workMessage], reply: "Tôi sẽ giúp theo dõi tiến độ kiểm kho." },
  ] } }));
  const helperRow = `document.querySelector('[data-sidebar-bot-row="${helper.id}"]')`;
  await until(() => evaluate(`Boolean(${helperRow})`), "the main helper in the sidebar");
  await evaluate(`${helperRow}.click()`);
  await send(workMessage);
  const offerCard = async () => {
    const result = await request(`/api/threads/${helper.threadId}/messages`);
    assert.equal(result.status, 200);
    return result.body.messages.find(row => row.card?.teamSetupRequest?.workBotOffer)?.card;
  };
  const offered = await until(offerCard, "the main helper to propose a dedicated bot");
  assert.equal(offered.teamSetupRequest.workBotOffer.icon, "box");
  assert.equal(offered.answered, undefined);
  assert(offered.title.includes(workName));
  const consent = `[...document.querySelectorAll('[data-work-bot-offer] button')].find(button => button.getClientRects().length && !button.disabled && button.textContent.trim() === ${JSON.stringify(offered.options[0])})`;
  await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(offered.title)}) && Boolean(${consent})`), "the visible work question and its consent button");
  assert.deepEqual((await roster()).map(row => row.id).sort(), initialBots.map(row => row.id).sort());
  const offerScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "work-bot-consent.png"), Buffer.from(offerScreenshot.data, "base64"));
  await until(() => evaluate(`Boolean(${composer})`), "the composer to stay usable while the suggestion is open");
  const extra = "Ghi nhận, tôi vẫn đang ở chat chính.";
  await send(extra);
  await until(async () => (await request(`/api/threads/${helper.threadId}/messages`)).body.messages.some(row => row.role === "user" && row.text === extra), "a second message to be accepted with the offer pending");
  assert.equal((await roster()).length, initialBots.length);
  await evaluate(`(${consent}).click()`);
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
  assert(readFileSync(path.join(data, "bots", workBot.id, "SOUL.md"), "utf8").includes(workMessage));
  assert.match(workBot.avatarUrl, /^\/api\/attachments\/[^/]+\.png$/);
  assert.deepEqual(await evaluate(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(workBot.avatarUrl)};
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  })()`), [128, 128]);
  const created = await request("/api/bots", { name: "Internal package agent", cwd: home });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bot = created.body.bot;
  assert(bot?.id, "Bot creation did not return its identity");
  const first = "Please answer this internal package fixture.";
  assert.equal((await request("/api/sidebar-sections", { name: "Package fixture", botIds: [bot.id] })).status, 200);
  assert.equal((await request(`/api/bots/${bot.id}`, { chiefOfStaff: true, approvalMode: "full" }, "PATCH")).status, 200);
  const specialist = "Trợ lý dữ liệu thử";
  const create = `Tạo một bot tên “${specialist}” để kiểm tra tệp dữ liệu thử.`;
  const newTitle = "Đối soát thử";
  const rename = `Đổi tên hội thoại này thành “${newTitle}”.`;
  const clear = "Xóa tin nhắn của đúng hội thoại này";
  const followup = "Continue the fixture conversation.";
  writeFileSync(plan, JSON.stringify({ [bot.id]: { script: [
    { key: "first", match: [first], reply },
    { key: "create", match: [create], steps: [
      { tool: "find_tool", arguments: { query: create }, capture: { selected: '"matches":\\[\\{"name":"([^"]+)"' } },
      { tool: "use_tool", arguments: { name: "{{selected}}", arguments: { name: specialist, role: "Kiểm tra dữ liệu", instructions: "Kiểm tra tệp dữ liệu thử khi được giao." } } },
    ], reply: "Đã tạo bot thử." },
    { key: "rename", match: [rename], steps: [{ tool: "rename_thread", arguments: { title: newTitle } }], reply: "Đã đổi tên hội thoại thử." },
    { key: "clear", match: [clear], steps: [{ tool: "app_settings", arguments: { action: "show_card", card: "clear-messages" } }], reply: "Confirm in chat." },
    { key: "followup", match: [followup], reply: "Fresh fixture reply." },
  ] } }));
  const sent = await request(`/api/bots/${encodeURIComponent(bot.id)}/messages`, { text: first });
  assert.equal(sent.status, 202, JSON.stringify(sent.body));
  await until(async () => {
    const transcript = await request(`/api/bots/${encodeURIComponent(bot.id)}`);
    assert.equal(transcript.status, 200);
    return JSON.stringify(transcript.body).includes(reply);
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
  const unauthenticated = await fetch(new URL("/api/auth/stream-ticket", target.url), { method: "POST", signal: AbortSignal.timeout(5_000) });
  assert([401, 403].includes(unauthenticated.status), "An external process must not inherit the renderer's mutation capability");
  assert.equal(createHash("sha256").update(readFileSync(sentinel)).digest("hex"), sentinelHash);
  assert(existsSync(path.join(data, "bots.json")), "The fixture must persist StartupBot's data");
  assert(existsSync(path.join(profile, "last-run-version.json")), "The explicit Electron profile must be used");
  assert.equal(existsSync(path.join(profile, "credentials.bin")), false, "First launch must not provision phone credentials before pairing");
  if (mac) {
    const id = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
    assert.equal(id, "ai.startupbot.desktop");
  }
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "startupbot-packaged.png"), Buffer.from(screenshot.data, "base64"));
  report = { ...report, status: "PASS", health: health.body, edition: edition.body, title, agentChat: "PASS (isolated fake engine, no paid model)",
    workBotOffer: { beforeConsent: 0, afterConsent: newBots.length, receiptVerified: true, instructionsVerified: true, avatarDecoded: true },
    appCommands: "PASS (direct rename and Vietnamese discovery-driven bot creation, verified actual title and roster)",
    clearMessages: "PASS (confirmed in packaged renderer; bot, thread and file retained; fresh reply)", dataIsolation: "PASS", rendererMutationBoundary: "PASS", welcomeAndHelperBranding: "PASS (real packaged renderer)", capabilities,
    computerUse: "Permission status observed; real user-desktop control NOT RUN", liveProvider: "NOT RUN" };
  await cdp("Browser.close").catch(() => {});
} catch (error) {
  report.error = error.stack;
  await captureFailure().catch(failure => { report.diagnosticsError = failure.message; });
  throw error;
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await until(() => child.exitCode !== null || child.signalCode !== null, "application shutdown", 15_000).catch(() => child.kill("SIGKILL"));
  if (mac && report.status === "PASS") {
    try {
      const network = desktopSmokeNetwork(JSON.parse(readFileSync(netLog, "utf8")));
      writeFileSync(path.join(evidence, "chromium-network.json"), JSON.stringify(network, null, 2) + "\n");
      assert.equal(network.faviconRequests, 0, "Service badges requested an external favicon");
    } catch (error) {
      report.status = "FAIL";
      report.error = error.message;
    }
  }
  writeFileSync(path.join(evidence, "desktop-smoke.json"), JSON.stringify(report, null, 2) + "\n");
  const appLog = path.join(profile, "logs", "server.log");
  writeFileSync(launchLog, output + (existsSync(appLog) ? `\n${readFileSync(appLog, "utf8")}` : ""));
  rmSync(fixture, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
}
assert.equal(report.status, "PASS", report.error);
console.log(JSON.stringify(report, null, 2));
