import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import path from "node:path";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function freePortExcept(used) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await freePort();
    if (!used.includes(port)) return port;
  }
  throw new Error("Could not allocate distinct synthetic test ports");
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

export async function smokeDesktopRestart({ executable, profile, fixture, env, helper, workBot, workMessage, workRequestId, replyText, followupText, followupReply, prompts, workspaceFile, fileContents = "synthetic report", botIds, evidence, lifecycle, routineId, legacyOffer, blockedWork, canceledHandoff, expectedSkin, expectedWorkspace, stablePort, usernameGroup }) {
  if (canceledHandoff && followupText) throw new Error("The handoff and upgrade follow-ups need separate fixtures");
  if (stablePort !== undefined && (!Number.isInteger(stablePort) || stablePort < 1024 || stablePort > 65535)) throw new Error("Invalid saved renderer port");
  if (expectedSkin && stablePort === undefined) throw new Error("Saved renderer port required for appearance verification");
  const port = stablePort ?? await freePort();
  const webhook = await freePortExcept([port]);
  const debug = await freePortExcept([port, webhook]);
  if (stablePort) await waitPortClosed(port, "the saved renderer origin to be available");
  const promptsBeforeRestart = readFileSync(prompts, "utf8");
  assert(promptsBeforeRestart.split("\n").filter(Boolean).map(line => JSON.parse(line)).some(prompt => JSON.stringify(prompt).includes(workMessage)), "The original work must have reached the provider");
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, "--remote-debugging-address=127.0.0.1", "--no-first-run"];
  lifecycle.started = true;
  lifecycle.stopped = false;
  const child = spawn(executable, args, { cwd: fixture, env: { ...env, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(webhook) }, stdio: ["ignore", "pipe", "pipe"] });
  let socket;
  let output = "";
  let spawnError;
  const rendererErrors = [];
  child.stdout.on("data", bytes => { output += bytes; });
  child.stderr.on("data", bytes => { output += bytes; });
  child.on("error", error => { spawnError = error; });
  try {
    const target = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Application exited with ${child.exitCode}: ${output}`);
      const pages = await fetch(`http://127.0.0.1:${debug}/json/list`, { signal: AbortSignal.timeout(2_000) }).then(response => response.json());
      return pages.find(page => page.type === "page" && page.url === `http://127.0.0.1:${port}/`);
    }, "the restarted renderer");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.exceptionThrown") rendererErrors.push({ kind: "exception", detail: message.params?.exceptionDetails?.text ?? "unknown" });
      if (message.method === "Inspector.targetCrashed") rendererErrors.push({ kind: "renderer-crash" });
      const entry = pending.get(message.id);
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
    await cdp("Runtime.enable");
    await cdp("Inspector.enable");
    await until(() => evaluate("Boolean(window.ogb?.getCapabilities && document.readyState === 'complete')"), "the restarted preload");
    if (expectedSkin) await until(() => evaluate(`localStorage.getItem('omb-skin') === ${JSON.stringify(expectedSkin)} && document.documentElement.dataset.skin === ${JSON.stringify(expectedSkin)}`), "the restored appearance choice");
    const request = route => evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route)});return {status:r.status,body:await r.json()};})()`);
    const bots = await until(async () => { const response = await request("/api/bots?messages=0"); return response.status === 200 && response.body.bots; }, "the restored bots");
    if (usernameGroup) {
      const snapshot = await request("/api/bots?messages=0");
      assert.deepEqual(snapshot.body.groups.find(group => group.id === usernameGroup.groupId)?.memberIds, [usernameGroup.botId], "The selected bot must remain in the group after restart");
    }
    assert.deepEqual(bots.map(bot => bot.id).sort(), [...botIds].sort());
    assert.equal(bots.find(bot => bot.id === helper.id)?.approvalMode, "full");
    if (expectedWorkspace) assert.equal(bots.find(bot => bot.id === helper.id)?.cwd, expectedWorkspace);
    assert.equal(bots.find(bot => bot.id === workBot.id)?.threadId, workBot.threadId);
    const rows = (await request(`/api/threads/${workBot.threadId}/messages`)).body.messages;
    if (legacyOffer) {
      const offer = rows.find(row => row.card?.requestId === legacyOffer.requestId);
      assert(offer && !offer.card.answered, "The baseline offer must remain pending");
      assert(!rows.find(row => row.id === legacyOffer.messageId)?.workBotRouting, "The baseline offer must predate routing");
      const beforePrompts = readFileSync(prompts, "utf8").split("\n").filter(Boolean).length;
      const decide = behavior => evaluate(`(async()=>{const r=await fetch(${JSON.stringify(`/api/threads/${workBot.threadId}/respond`)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:${JSON.stringify(legacyOffer.requestId)},behavior:${JSON.stringify(behavior)}})});return {status:r.status,body:await r.json()};})()`);
      const refused = await decide("allow");
      assert.equal(refused.status, 409);
      assert.match(refused.body.error, /earlier suggestion|đề xuất cũ/i);
      assert.equal((await decide("deny")).status, 200);
      assert.deepEqual((await request("/api/bots?messages=0")).body.bots.map(bot => bot.id).sort(), [...botIds].sort());
      assert.equal(readFileSync(prompts, "utf8").split("\n").filter(Boolean).length, beforePrompts);
    }
    assert(rows.some(row => row.id === workRequestId && row.text === workMessage && row.requestPending === false));
    assert(rows.some(row => row.role === "bot" && row.turnTerminal && row.turnSucceeded && row.requestMessageId === workRequestId && (replyText === undefined || row.text === replyText)));
    if (blockedWork) {
      const sourceRows = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages;
      const matching = sourceRows.filter(row => row.role === "user" && row.text === blockedWork.text);
      assert.equal(matching.length, 1);
      assert.equal(matching[0].id, blockedWork.sourceId);
      assert(sourceRows.some(row => row.turnTerminal && row.turnSucceeded && row.requestMessageId === blockedWork.sourceId));
      assert.equal(sourceRows.find(row => row.card?.requestId === blockedWork.cardId)?.card?.teamSetupRequest?.result?.state, "denied");
    }
    const botRow = `document.querySelector('[data-sidebar-bot-row="${workBot.id}"]')`;
    await until(() => evaluate(`Boolean(${botRow})`), "the restored bot in the sidebar");
    await evaluate(`${botRow}.click()`);
    await until(() => evaluate(`${botRow}?.getAttribute('aria-current') === 'page' && document.body.innerText.includes(${JSON.stringify(workMessage)})`), "the restored conversation on screen");
    assert.equal(readFileSync(workspaceFile, "utf8"), fileContents);
    if (routineId) {
      const state = (await request("/api/routines")).body;
      assert.equal(state.routines.find(routine => routine.id === routineId)?.enabled, false);
      assert(!state.runs.some(run => run.routineId === routineId));
    }
    assert.equal(readFileSync(prompts, "utf8"), promptsBeforeRestart, "Restart must not issue another provider call");
    await new Promise(resolve => setTimeout(resolve, 3_000));
    assert.equal(readFileSync(prompts, "utf8"), promptsBeforeRestart, "Restart must not replay a pending request");
    if (canceledHandoff) {
      const source = (await request(`/api/threads/${helper.threadId}/messages`)).body.messages.find(row => row.id === canceledHandoff.sourceId);
      const target = (await request(`/api/threads/${canceledHandoff.threadId}/messages`)).body.messages.find(row => row.id === canceledHandoff.requestId);
      assert.equal(source?.workBotRouting?.targetBotId, canceledHandoff.targetId);
      assert.equal(target?.workBotHandoffSource?.messageId, canceledHandoff.sourceId);
      assert.equal(target?.requestCancelled, true);
      assert.equal(existsSync(canceledHandoff.continued), false);
      assert.equal(readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(canceledHandoff.text)).length, 1);
      const targetRow = `document.querySelector('[data-sidebar-bot-row="${canceledHandoff.targetId}"]')`;
      await until(() => evaluate(`Boolean(${targetRow})`), "the canceled handoff bot after restart");
      await evaluate(`${targetRow}.click()`);
      await until(() => evaluate(`${targetRow}?.getAttribute('aria-current') === 'page'`), "the canceled conversation after restart");
      const composer = `[...document.querySelectorAll("textarea")].findLast(input => input.getClientRects().length && !input.disabled)`;
      await until(() => evaluate(`Boolean(${composer})`), "the canceled conversation composer");
      await evaluate(`(${composer}).focus()`);
      await cdp("Input.insertText", { text: canceledHandoff.followup });
      const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
      await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyDown" });
      await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyUp" });
      await until(async () => {
        const messages = (await request(`/api/threads/${canceledHandoff.threadId}/messages`)).body.messages;
        const inputs = messages.filter(row => row.role === "user" && row.text === canceledHandoff.followup);
        return inputs.length === 1 && inputs[0].requestPending === false && messages.some(row => row.role === "bot" && row.turnTerminal && row.turnSucceeded && row.requestMessageId === inputs[0].id && row.text === "Synthetic handoff remains usable.");
      }, "a new turn after the canceled handoff");
      assert.equal(existsSync(canceledHandoff.continued), false);
      const after = readFileSync(prompts, "utf8");
      assert(after.startsWith(promptsBeforeRestart));
      const newPrompts = after.slice(promptsBeforeRestart.length).split("\n").filter(Boolean).map(line => JSON.parse(line));
      assert.equal(newPrompts.length, 1);
      assert(JSON.stringify(newPrompts[0]).includes(canceledHandoff.followup));
      assert(!JSON.stringify(newPrompts[0]).includes(canceledHandoff.text), "The follow-up must not replay the canceled request");
      assert(JSON.stringify(newPrompts[0]).includes("This earlier request was stopped"), "The follow-up must retain the stop marker");
    }
    if (followupText) {
      const before = (await request(`/api/threads/${workBot.threadId}/messages`)).body.messages;
      assert(!before.some(row => row.role === "user" && row.text === followupText));
      assert.equal(readFileSync(prompts, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => JSON.stringify(prompt).includes(followupText)).length, 0);
      const composer = `[...document.querySelectorAll("textarea")].findLast(input => input.getClientRects().length && !input.disabled)`;
      await until(() => evaluate(`Boolean(${composer})`), "the restored conversation composer");
      await evaluate(`(${composer}).focus()`);
      await cdp("Input.insertText", { text: followupText });
      assert.equal(await evaluate("document.activeElement.value"), followupText);
      const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
      await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyDown" });
      await cdp("Input.dispatchKeyEvent", { ...enter, type: "keyUp" });
      await until(async () => {
        const messages = (await request(`/api/threads/${workBot.threadId}/messages`)).body.messages;
        const input = messages.find(row => row.role === "user" && row.text === followupText);
        return input?.requestPending === false && messages.filter(row => row.role === "user" && row.text === followupText).length === 1 && messages.some(row => row.role === "bot" && row.text === followupReply && row.turnTerminal && row.turnSucceeded && row.requestMessageId === input.id);
      }, "a new reply in the restored conversation");
      const promptsAfterFollowup = readFileSync(prompts, "utf8");
      assert(promptsAfterFollowup.startsWith(promptsBeforeRestart), "Follow-up must preserve prior provider evidence");
      const newPrompts = promptsAfterFollowup.slice(promptsBeforeRestart.length).split("\n").filter(Boolean).map(line => JSON.parse(line));
      assert.equal(newPrompts.length, 1, "Follow-up must start exactly one provider turn");
      assert(JSON.stringify(newPrompts[0]).includes(followupText), "The new provider turn must contain the follow-up");
    }
    assert.deepEqual(rendererErrors, [], "The restarted renderer reported an uncaught exception or crash");
    if (process.platform === "darwin") { socket.close(); child.kill("SIGTERM"); }
    else await cdp("Browser.close").catch(() => {});
    await until(() => child.exitCode !== null || child.signalCode !== null, "the restarted application to exit", 45_000);
    await waitPortClosed(port, "the restarted server to stop");
    assert.deepEqual(rendererErrors, [], "The restarted renderer reported an uncaught exception or crash");
    return { status: "PASS", sameBotAndThread: true, workRequestId, noReplayObservedMs: 3000, fileRetained: true, fullAccessRetained: true, theme: expectedSkin ? "PASS" : "NOT RUN", workspace: expectedWorkspace ? "PASS" : "NOT RUN" };
  } finally {
    socket?.close();
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await until(() => spawnError || child.exitCode !== null || child.signalCode !== null, "restarted application shutdown", 15_000).catch(() => child.kill("SIGKILL"));
      await until(() => spawnError || child.exitCode !== null || child.signalCode !== null, "restarted application exit", 15_000);
      await waitPortClosed(port, "restarted server shutdown");
      lifecycle.stopped = true;
    } finally {
      writeFileSync(path.join(evidence, "desktop-restart-renderer-errors.json"), JSON.stringify(rendererErrors, null, 2) + "\n");
      writeFileSync(path.join(evidence, "desktop-restart.log"), output);
    }
  }
}
