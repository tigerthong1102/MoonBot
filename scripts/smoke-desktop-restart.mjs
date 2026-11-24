import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import path from "node:path";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(read, label, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await read(); if (result) return result; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ""}`);
}

export async function waitPortClosed(port, label) {
  await until(() => new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", error => { socket.destroy(); resolve(error.code === "ECONNREFUSED"); });
  }), label, 15_000);
}

export async function smokeDesktopRestart({ executable, profile, fixture, env, helper, workBot, workMessage, workRequestId, prompts, workspaceFile, botIds, evidence, lifecycle }) {
  const port = await freePort(), webhook = await freePort(), debug = await freePort();
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, "--remote-debugging-address=127.0.0.1", "--no-first-run"];
  lifecycle.started = true;
  const child = spawn(executable, args, { cwd: fixture, env: { ...env, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(webhook) }, stdio: ["ignore", "pipe", "pipe"] });
  let socket;
  let output = "";
  let spawnError;
  child.stdout.on("data", bytes => { output += bytes; });
  child.stderr.on("data", bytes => { output += bytes; });
  child.on("error", error => { spawnError = error; });
  try {
    const target = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Application exited with ${child.exitCode}: ${output}`);
      const pages = await fetch(`http://127.0.0.1:${debug}/json/list`, { signal: AbortSignal.timeout(2_000) }).then(response => response.json());
      return pages.find(page => page.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(page.url));
    }, "the restarted renderer");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)), entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    });
    socket.addEventListener("close", () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Restarted renderer disconnected")); } pending.clear(); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 30_000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    await until(() => evaluate("Boolean(window.ogb?.getCapabilities && document.readyState === 'complete')"), "the restarted preload");
    const request = route => evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route)});return {status:r.status,body:await r.json()};})()`);
    const bots = await until(async () => { const response = await request("/api/bots?messages=0"); return response.status === 200 && response.body.bots; }, "the restored bots");
    assert.deepEqual(bots.map(bot => bot.id).sort(), [...botIds].sort());
    assert.equal(bots.find(bot => bot.id === helper.id)?.approvalMode, "full");
    assert.equal(bots.find(bot => bot.id === workBot.id)?.threadId, workBot.threadId);
    const rows = (await request(`/api/threads/${workBot.threadId}/messages`)).body.messages;
    assert(rows.some(row => row.id === workRequestId && row.text === workMessage && row.requestPending === false));
    assert(rows.some(row => row.role === "bot" && row.turnTerminal && row.turnSucceeded && row.requestMessageId === workRequestId));
    const botRow = `document.querySelector('[data-sidebar-bot-row="${workBot.id}"]')`;
    await until(() => evaluate(`Boolean(${botRow})`), "the restored bot in the sidebar");
    await evaluate(`${botRow}.click()`);
    await until(() => evaluate(`${botRow}?.getAttribute('aria-current') === 'page' && document.body.innerText.includes(${JSON.stringify(workMessage)})`), "the restored conversation on screen");
    assert.equal(readFileSync(workspaceFile, "utf8"), "synthetic report");
    const promptCount = () => readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(workMessage)).length;
    assert.equal(promptCount(), 1);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    assert.equal(promptCount(), 1);
    if (process.platform === "darwin") { socket.close(); child.kill("SIGTERM"); }
    else await cdp("Browser.close").catch(() => {});
    await until(() => child.exitCode !== null || child.signalCode !== null, "the restarted application to exit", 45_000);
    await waitPortClosed(port, "the restarted server to stop");
    return { status: "PASS", sameBotAndThread: true, workRequestId, noReplayObservedMs: 3000, fileRetained: true, fullAccessRetained: true };
  } finally {
    socket?.close();
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await until(() => spawnError || child.exitCode !== null || child.signalCode !== null, "restarted application shutdown", 15_000).catch(() => child.kill("SIGKILL"));
      await until(() => spawnError || child.exitCode !== null || child.signalCode !== null, "restarted application exit", 15_000);
      await waitPortClosed(port, "restarted server shutdown");
      lifecycle.stopped = true;
    } finally { writeFileSync(path.join(evidence, "desktop-restart.log"), output); }
  }
}
