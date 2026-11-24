import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desktopSmokeNetwork } from "./desktop-smoke-network.mjs";
import { smokeDesktopRestart, waitPortClosed } from "./smoke-desktop-restart.mjs";

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
let captureFailure = async () => {};
const restartLifecycle = { started: false, stopped: false };
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
  if (values["create-upgrade-fixture"]) {
    const oldText = "Synthetic archived inventory note 4102", oldReply = "Synthetic archived result 4102";
    writeFileSync(plan, JSON.stringify({ [helper.id]: { script: [{ key: "old-message", match: [oldText], reply: oldReply }] } }));
    await until(async () => !(await roster()).find(row => row.id === helper.id)?.busy, "the baseline helper to become idle");
    const helperRow = `document.querySelector('[data-sidebar-bot-row="${helper.id}"]')`;
    await until(() => evaluate(`Boolean(${helperRow})`), "the baseline helper row");
    await evaluate(`${helperRow}.click()`);
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
    if (mac) { socket.close(); child.kill("SIGTERM"); }
    else await cdp("Browser.close").catch(() => {});
    await until(() => child.exitCode !== null || child.signalCode !== null, "the baseline application shutdown", 45_000);
    await waitPortClosed(port, "the baseline server shutdown");
    const destination = path.resolve(values["create-upgrade-fixture"]);
    mkdirSync(destination);
    try {
      cpSync(fixture, destination, { recursive: true, errorOnExist: true, force: false });
      writeFileSync(path.join(destination, "expected.json"), JSON.stringify({ botId: helper.id, threadId: helper.threadId, oldText, oldReply, messageId: oldMessage.id, routineId: routine.body.routine.id }));
    } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
    report = { ...report, status: "PASS", baselineFixture: destination };
  } else {
  assert(!initialBots.some(row => row.name === workName));
  const extra = "Ghi nhận, tôi vẫn đang ở chat chính.";
  const extraNext = "Xin xác nhận ghi chú thử thứ hai.";
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
  await send(workMessage);
  const offerCard = async () => {
    const result = await request(`/api/threads/${helper.threadId}/messages`);
    assert.equal(result.status, 200);
    return result.body.messages.find(row => row.card?.teamSetupRequest?.workBotOffer)?.card;
  };
  const offered = await until(offerCard, "the main helper to propose a dedicated bot");
  assert.equal(offered.teamSetupRequest.workBotOffer.icon, "calendar");
  assert.equal(offered.answered, undefined);
  assert(offered.title.includes(workName));
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
  const queuedCompletion = await until(() => completedRequest(helper.threadId, extra), "the queued request to settle by ID");
  const nextCompletion = await until(() => completedRequest(helper.threadId, extraNext), "the next queued request to settle by ID");
  assert.notEqual(workCompletion.requestId, queuedCompletion.requestId);
  assert.notEqual(workCompletion.turnId, queuedCompletion.turnId);
  assert.notEqual(queuedCompletion.requestId, nextCompletion.requestId);
  assert.notEqual(queuedCompletion.turnId, nextCompletion.turnId);
  writeFileSync(path.join(evidence, "work-bot-prompt-fixture.json"), JSON.stringify(workPrompts(), null, 2) + "\n");
  assert.equal(workPrompts().length, 1);
  const handedOffScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "work-bot-handoff.png"), Buffer.from(handedOffScreenshot.data, "base64"));
  assert(readFileSync(path.join(data, "bots", workBot.id, "SOUL.md"), "utf8").includes(workMessage));
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
  const botIds = (await roster()).map(row => row.id);
  if (mac) { socket.close(); child.kill("SIGTERM"); }
  else await cdp("Browser.close").catch(() => {});
  await until(() => child.exitCode !== null || child.signalCode !== null, "the first application shutdown", 45_000);
  await waitPortClosed(port, "the first server to stop");
  const restart = await smokeDesktopRestart({ executable, profile, fixture, env, helper, workBot, workMessage, workRequestId: workCompletion.requestId, prompts, workspaceFile, botIds, evidence, lifecycle: restartLifecycle });
  report = { ...report, status: "PASS", health: health.body, edition: edition.body, title, agentChat: "PASS (isolated fake engine, no paid model)",
    workBotOffer: { beforeConsent: 0, afterConsent: newBots.length, receiptVerified: true, instructionsVerified: true, avatarDecoded: true, workCompletion, queuedCompletion, nextCompletion, declinedCompletion },
    appCommands: "PASS (direct rename and Vietnamese discovery-driven bot creation, verified actual title and roster)",
    clearMessages: "PASS (confirmed in packaged renderer; bot, thread and file retained; fresh reply)", dataIsolation: "PASS", remoteOnlyPhoneLink: "PASS", rendererMutationBoundary: "PASS", welcomeAndHelperBranding: "PASS (real packaged renderer)", capabilities,
    restart, computerUse: "Permission status observed; real user-desktop control NOT RUN", liveProvider: "NOT RUN" };
  }
} catch (error) {
  report.error = error.stack;
  await captureFailure().catch(failure => { report.diagnosticsError = failure.message; });
  throw error;
} finally {
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
    writeFileSync(path.join(evidence, "desktop-smoke.json"), JSON.stringify(report, null, 2) + "\n");
    const appLog = path.join(profile, "logs", "server.log");
    writeFileSync(launchLog, output + (existsSync(appLog) ? `\n${readFileSync(appLog, "utf8")}` : ""));
    if (!report.retainedFixture) rmSync(fixture, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
}
assert.equal(report.status, "PASS", report.error);
console.log(JSON.stringify(report, null, 2));
