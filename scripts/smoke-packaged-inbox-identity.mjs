import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, createPublicKey, randomUUID, verify, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createConnection, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { smokeWindowsQuit } from "./smoke-windows-quit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), scope = "00000000-0000-4000-8000-000000000000";
const { values } = parseArgs({ options: { app: { type: "string" }, output: { type: "string" } } });
assert(values.app && values.output, "--app and --output are required");
const fixture = mkdtempSync(path.join(tmpdir(), "startupbot-inbox-package-")), evidence = path.resolve(values.output);
const home = path.join(fixture, "home"), data = path.join(home, ".startupbot"), profile = path.join(fixture, "profile");
for (const dir of [home, data, profile, evidence]) mkdirSync(dir, { recursive: true });
const keyPath = path.join(fixture, "fixture-key.pem"), certPath = path.join(fixture, "fixture-cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
const cert = readFileSync(certPath), key = readFileSync(keyPath);
const pin = createHash("sha256").update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" })).digest("base64");
const owner = "synthetic-owner", room = randomUUID(), nonces = new Map(), registered = new Map(), members = new Set();
const counts = { identityChallenges: 0, identityRegistrations: 0, signedInvites: 0, invalidProofs: 0, unsignedInvites: 0, turns: 0 };
let origin;
const cloud = createHttpsServer({ key, cert }, async (req, res) => {
  const reply = (status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  try {
    const url = new URL(req.url, origin), pathname = url.pathname;
    if (pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<button id="fixture-invite" onclick="window.open('/desktop/invite-bot/${room}', '_blank')">Fixture invite</button>`); return; }
    if (pathname === "/api/auth/email-otp/send-verification-otp") return reply(200, { ok: true });
    if (pathname === "/api/auth/sign-in/email-otp") return reply(200, { ok: true }, { "set-cookie": "fixture_session=1; Secure; HttpOnly; SameSite=Lax; Path=/" });
    if (!String(req.headers.cookie ?? "").includes("fixture_session=1")) return reply(401, { error: "unauthorized" });
    if (pathname === "/api/me") return reply(200, { id: owner, email: "synthetic@example.test" });
    if (pathname === "/api/bot-turns") { counts.turns++; return reply(200, { jobs: [] }); }
    if (req.method !== "POST" || !["/api/bot-identities", `/api/rooms/${room}/bots`].includes(pathname)) return reply(404, { error: "unavailable" });
    let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw Error("fixture_request_too_large"); }
    const input = JSON.parse(raw), identityOnly = pathname === "/api/bot-identities", claimScope = identityOnly ? scope : room;
    if (input.action === "challenge") { if (identityOnly) counts.identityChallenges++; const nonce = randomUUID(); nonces.set(nonce, { bot: input.bot, claimScope }); return reply(200, { nonce }); }
    if (input.action !== (identityOnly ? "register" : "invite")) return reply(400, { error: "invalid_request" });
    if ((!identityOnly && input.owner !== owner) || input.name !== (identityOnly ? "Bot" : "Synthetic Inbox Bot")) return reply(403, { error: "invalid_identity_metadata" });
    if (!input.proof || !input.username) { counts.unsignedInvites++; return reply(403, { error: "proof_required" }); }
    const proof = input.proof, challenge = nonces.get(proof.nonce);
    const publicBytes = Buffer.from(proof.publicKey, "hex"), publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBytes]), format: "der", type: "spki" });
    const payload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", origin, owner, input.bot, claimScope, proof.nonce]));
    const valid = challenge?.bot === input.bot && challenge.claimScope === claimScope && input.username === `bot_k${createHash("sha256").update(publicBytes).digest("hex")}` && verify(null, payload, publicKey, Buffer.from(proof.signature, "hex"));
    if (!valid || (registered.has(input.bot) && registered.get(input.bot) !== input.username)) { counts.invalidProofs++; return reply(403, { error: "invalid_proof" }); }
    nonces.delete(proof.nonce); registered.set(input.bot, input.username);
    if (identityOnly) counts.identityRegistrations++; else { counts.signedInvites++; members.add(input.bot); }
    return reply(200, { ok: true });
  } catch { reply(500, { error: "fixture_error" }); }
});

async function port() { const server = createTcpServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
async function until(read, label, timeout = 90_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const result = await read(); if (result) return result; } catch (error) { last = error; } await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${label}${last ? ` (${last.message})` : ""}`); }
async function connect(url) {
  const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0; const pending = new Map();
  socket.addEventListener("message", event => { const frame = JSON.parse(String(event.data)); if (!frame.id) return; const item = pending.get(frame.id); if (!item) return; pending.delete(frame.id); if (frame.error) item.reject(Error(frame.error.message)); else item.resolve(frame.result); });
  return { socket, call: (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20_000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); }) };
}
async function evaluate(cdp, expression) { const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function disconnect(connection) {
  const socket = connection?.socket;
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Debugger did not disconnect")), 5_000);
    socket.addEventListener("close", () => { clearTimeout(timer); resolve(); }, { once: true });
    if (socket.readyState === WebSocket.OPEN) socket.close();
  });
}

let child, inspector, renderer, inbox, appPort, result, failure, cleanupFailure, log = "";
try {
  await new Promise(resolve => cloud.listen(0, "127.0.0.1", resolve)); origin = `https://127.0.0.1:${cloud.address().port}`;
  appPort = await port(); const webhookPort = await port(), debugPort = await port(), inspectPort = await port();
  writeFileSync(path.join(data, "config.json"), JSON.stringify({ language: "en", profile: { name: "Fixture Owner" }, features: { smartSetupChoices: false }, instances: { claude: { driver: "claudeAgent", displayName: "Fixture", config: { cli: path.join(root, "server", "testing", "fake-claude-cli.ts") }, environment: {} } } }));
  const mac = process.platform === "darwin", executable = mac ? path.join(path.resolve(values.app), "Contents", "MacOS", "StartupBot") : path.resolve(values.app);
  const env = { PATH: process.env.PATH, HOME: mac ? process.env.HOME : home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
    OMB_DATA_DIR: data, OMB_SMOKE_HOME: home, OMB_SMOKE_TEST: "1", OMB_SMOKE_KEEP_OPEN: "1", OMB_SMOKE_CUA: "0", OMB_COMPANION_BONJOUR: "0", OMB_PORT: String(appPort), OMB_WEBHOOK_PORT: String(webhookPort), STARTUPBOT_INBOX_ORIGIN: origin,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {}), ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}) };
  child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, `--inspect=127.0.0.1:${inspectPort}`, `--ignore-certificate-errors-spki-list=${pin}`], { env, cwd: fixture, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", value => { log += value; }); child.stderr.on("data", value => { log += value; });
  const target = await until(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json())).find(item => item.type === "page" && item.url === `http://127.0.0.1:${appPort}/`), "fixture renderer");
  renderer = await connect(target.webSocketDebuggerUrl);
  const mainTarget = await until(async () => (await fetch(`http://127.0.0.1:${inspectPort}/json/list`).then(r => r.json()))[0], "main inspector");
  inspector = await connect(mainTarget.webSocketDebuggerUrl);
  await evaluate(inspector, `(()=>{const r=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const e=r('electron');const original=e.Menu.buildFromTemplate.bind(e.Menu);globalThis.__fixtureMenus=[];e.Menu.buildFromTemplate=(template)=>{const menu=original(template);if(template.some(item=>item.label?.startsWith('Synthetic Inbox Bot')))globalThis.__fixtureMenus.push(menu);return menu};return true})()`);
  await until(() => evaluate(renderer, "Boolean(window.ogb?.personalAccount && window.ogb?.openPersonalInbox)"), "desktop Inbox bridge");
  await until(() => evaluate(renderer, "Boolean(document.querySelector('[data-welcome=meet]'))"), "first-run welcome");
  await until(() => evaluate(renderer, `(()=>{const next=document.querySelector('[data-welcome=meet] [data-primary]:not([data-sign-in]):not([disabled])');if(!next)return false;next.click();return true})()`), "first-run Next");
  await until(() => evaluate(renderer, `(()=>{const button=document.querySelector('[data-chief-create]:not([disabled])');return button?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}))===true})()`), "first-run bot creation");
  await until(() => evaluate(renderer, "!document.querySelector('[data-welcome], [data-chief-intro]') && Boolean(document.querySelector('[data-startupbot-avatar]'))"), "interactive StartupBot chat");
  console.log("Fixture: authenticating");
  assert.equal(await evaluate(renderer, "window.ogb.personalAccount.sendCode('synthetic@example.test')"), "ok");
  assert.equal(await evaluate(renderer, "window.ogb.personalAccount.verify('synthetic@example.test','12345678')"), "ok");
  const createBot = () => evaluate(renderer, `(async()=>{const r=await fetch('/api/bots',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Synthetic Inbox Bot',cwd:${JSON.stringify(home)}})});return {status:r.status,body:await r.json()}})()`);
  const first = await createBot(), second = await createBot(); assert.equal(first.status, 201); assert.equal(second.status, 201);
  console.log("Fixture: opening Inbox");
  await evaluate(renderer, "window.ogb.openPersonalInbox()");
  const inboxTarget = await until(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json())).find(item => item.type === "page" && item.url.startsWith(origin)), "fixture Inbox view");
  inbox = await connect(inboxTarget.webSocketDebuggerUrl);
  console.log("Fixture: preparing signed identities");
  await until(async () => registered.size >= 2 && await evaluate(renderer, "fetch('/api/personal-inbox/bots').then(r=>r.json()).then(x=>x.bots.filter(b=>b.name==='Synthetic Inbox Bot'&&b.username).length===2)"), "two registered identities");
  assert.equal(members.size, 0, "Preparing identities must not join a room");
  await evaluate(inbox, "document.getElementById('fixture-invite').click()");
  const labels = await until(() => evaluate(inspector, "globalThis.__fixtureMenus.at(-1)?.items.map(item=>item.label)"), "native bot menu");
  const matching = labels.filter(label => /^Synthetic Inbox Bot \(@bot_k[a-f0-9]{64}\)$/.test(label));
  assert.equal(matching.length, 2, "Two same-name bots must have distinct registered usernames"); assert.notEqual(matching[0], matching[1]); assert.equal(members.size, 0, "Preparing identities must not join a room");
  const username = matching[0].match(/@([^)]*)/)[1];
  await evaluate(inspector, `(()=>{const menu=globalThis.__fixtureMenus.at(-1),item=menu.items.find(i=>i.label===${JSON.stringify(matching[0])});if(!item||!item.enabled)throw Error('fixture item unavailable');item.click(item,null,{});menu.closePopup();return true})()`);
  await until(() => counts.signedInvites === 1 && members.size === 1, "one signed invitation");
  const inventory = await until(async () => { const value = await evaluate(renderer, "fetch('/api/personal-inbox/bots').then(r=>r.json())"); return value?.bots?.some(bot => bot.username === username) && value; }, "registered local inventory");
  assert.equal(inventory.bots.filter(bot => bot.username === username).length, 1);
  assert.equal([...members].filter(id => registered.get(id) === username).length, 1);
  assert.equal(counts.unsignedInvites, 0); assert.equal(counts.invalidProofs, 0);
  result = { status: "PASS", fixture: "loopback TLS fake Cloud", sameNameBots: 2, distinctVerifiedUsernames: true, signedInvites: counts.signedInvites, roomMembers: members.size, unsignedInvites: counts.unsignedInvites, invalidProofs: counts.invalidProofs, nativeMenuSelection: "Electron main debugger invoked the built MenuItem click; physical keyboard not tested", scope: "no legacy Cloud-room upgrade" };
  await disconnect(inbox);
  assert.equal(await evaluate(inspector, "process.pid"), child.pid, "The main debugger must belong to the fixture application");
  if (process.platform === "win32") {
    await disconnect(inspector);
    await smokeWindowsQuit({ inspect: inspectPort, evaluate: expression => evaluate(renderer, expression), expectedPid: child.pid });
  } else {
    await evaluate(inspector, "(()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');setTimeout(()=>e.app.quit(),10);return true})()");
    await disconnect(inspector);
  }
  await disconnect(renderer);
  await until(() => child.exitCode !== null || child.signalCode !== null, "fixture application shutdown", 45_000);
  assert.equal(child.exitCode, 0, "Fixture application must exit cleanly"); assert.equal(child.signalCode, null);
  await until(() => new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port: appPort }); socket.setTimeout(500); socket.once("connect", () => { socket.destroy(); resolve(false); }); socket.once("timeout", () => { socket.destroy(); resolve(false); }); socket.once("error", error => { socket.destroy(); resolve(error.code === "ECONNREFUSED"); }); }), "fixture server shutdown", 15_000);
} catch (error) {
  failure = error;
} finally {
  if (failure && process.platform === "win32" && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted" && child?.pid) {
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; $root=[System.Windows.Automation.AutomationElement]::RootElement; $scope=[System.Windows.Automation.TreeScope]::Children; $filter=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$env:STARTUPBOT_FIXTURE_PID); $windows=$root.FindAll($scope,$filter); $out=@(); foreach($window in $windows){$out+=@($window.Current.Name); $out+=@($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Select-Object -First 200 | ForEach-Object {$_.Current.Name})}; $out | ConvertTo-Json | Set-Content -Encoding utf8 $env:STARTUPBOT_FIXTURE_UIA`], { timeout: 15_000, env: { ...process.env, STARTUPBOT_FIXTURE_PID: String(child.pid), STARTUPBOT_FIXTURE_UIA: path.join(evidence, "packaged-inbox-failure-windows.json") }, stdio: "ignore" });
    } catch {}
  }
  for (const connection of [inbox, renderer, inspector]) connection?.socket.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM"); await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 10_000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 10_000))]); }
  }
  cloud.closeAllConnections();
  await new Promise(resolve => cloud.close(resolve));
  writeFileSync(path.join(evidence, "packaged-inbox-identity.log"), log);
  try { rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (error) { cleanupFailure = error; failure ??= error; }
}
if (failure) {
  const report = { status: "FAIL", fixture: "loopback TLS fake Cloud", reason: failure.message, ...(cleanupFailure ? { cleanupFailure: cleanupFailure.message } : {}), counts };
  writeFileSync(path.join(evidence, "packaged-inbox-identity.json"), JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify(report));
  throw failure;
}
writeFileSync(path.join(evidence, "packaged-inbox-identity.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", evidence }));
