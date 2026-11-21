import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withFixture } from "../cua-win-qualification.mjs";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";

const promptCount = async path => (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).length;

export async function qualifyWindowsChat(invoke, connection) {
  assert.equal(process.platform, "win32");
  assert.equal(process.env.OMB_CUA_ISOLATED_DESKTOP, "1");
  const temp = await mkdtemp(join(tmpdir(), "startupbot-win-chat-"));
  const grant = join(temp, "cua.json"), calls = join(temp, "calls.json"), prompts = join(temp, "prompts.jsonl");
  let server;
  try {
    await writeFile(grant, JSON.stringify(connection), { flag: "wx" });
    await writeFile(calls, "[]", { flag: "wx" });
    await writeFile(prompts, "", { flag: "wx" });
    server = await launchVerificationServer({
      WINDIR: process.env.WINDIR, SYSTEMROOT: process.env.SYSTEMROOT,
      COMSPEC: process.env.COMSPEC, PATHEXT: process.env.PATHEXT,
      OMB_TEST_DESKTOP_CUA_CONNECTION: grant,
      FAKE_CLAUDE_WINDOWS_NAVIGATION_FIXTURE: "1",
      FAKE_CLAUDE_TOOL_CALLS_FILE: calls, FAKE_CLAUDE_PROMPTS: prompts,
      FAKE_CLAUDE_REPLIES: '["Fixture navigation completed."]',
    }, AbortSignal.timeout(45_000));
    const { url, dataDir } = server.info;
    const request = async (path, method = "GET", body) => {
      const result = await fetch(url + path, {
        method, headers: { origin: url, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
      });
      assert.ok(result.ok, method + " " + path + ": " + result.status + " " + (result.ok ? "" : await result.text()));
      return result.json();
    };
    const run = (...args) => runControlOmb([...args, "--url", url]);
    await request("/api/config", "PATCH", { features: { savedSteps: true } });
    const { bot } = await run("new-bot", "--name", "Windows Navigation Fixture");
    assert.ok(bot.id && bot.activeTaskId, "fixture bot/task was not created");
    const args = ["--bot", bot.id, "--task", bot.activeTaskId];
    await request("/api/bots/" + bot.id + "/tasks/" + bot.activeTaskId, "PATCH", { surface: "local" });
    const title = "StartupBot CUA qualification " + randomUUID();
    const destination = title + " - Destination";
    const text = 'Navigate using button "Navigate fixture" and verify window title "' + destination + '"';
    const thread = "/api/threads/" + bot.activeTaskId;
    const transcript = async () => (await request(thread + "/messages?limit=100")).messages;
    const chat = async expectedApproval => {
      const seen = new Set((await transcript()).map(message => message.id));
      const started = performance.now();
      await run("send", ...args, "--text", text);
      let approval;
      if (expectedApproval) {
        const automatic = `approved mcp__computer__click (full access): ${expectedApproval}`;
        const deadline = Date.now() + 8_000;
        do {
          const fresh = (await transcript()).filter(message => !seen.has(message.id));
          const pending = fresh.flatMap(message => message.card?.requestId && !message.card.answered && !message.card.dismissed ? [message.card] : []);
          assert.ok(pending.length <= 1, "unexpected concurrent approval request");
          if (pending.length) {
            const [card] = pending;
            assert.equal(card.requestType, "permission");
            assert.equal(card.approvalScope, "local-computer");
            assert.equal(card.tool, "mcp__computer__click");
            assert.equal(card.subtitle, expectedApproval);
            assert.notEqual(card.allowSession, true);
            const response = await request(thread + "/respond", "POST", { requestId: card.requestId, behavior: "allow" });
            assert.equal(response.outcome, "allowed-once");
            approval = "explicit-once";
          } else if (fresh.some(message => message.tool?.ok === true && message.tool.name === automatic)) {
            approval = "full-access-once";
          }
          if (!approval) await delay(50);
        } while (!approval && Date.now() < deadline);
        assert.ok(approval, "replay did not request or receive expected click approval");
      }
      const approvalObservedMs = Math.round(performance.now() - started);
      const settled = await run("wait", ...args, "--timeout", "15");
      assert.equal(settled.status, "settled", JSON.stringify(settled));
      if (approval) {
        const approved = (await transcript()).filter(message => !seen.has(message.id) && (
          message.card?.tool === "mcp__computer__click" && message.card.answered === "allow"
          || message.tool?.ok === true && message.tool.name === `approved mcp__computer__click (full access): ${expectedApproval}`
        ));
        assert.equal(approved.length, 1, "unexpected approval count");
      }
      return { ms: Math.round(performance.now() - started), approval, approvalObservedMs };
    };
    const marker = async key => {
      const deadline = Date.now() + 1_500;
      do {
        const { messages } = await request("/api/threads/" + bot.activeTaskId + "/messages?limit=100");
        const matches = messages.filter(message => message.savedSteps?.[key]);
        assert.ok(matches.length <= 1, "duplicate " + key + " marker");
        if (matches.length === 1) return matches[0].savedSteps.recipeId;
        await delay(50);
      } while (Date.now() < deadline);
      throw Error("missing " + key + " marker");
    };
    async function verify(fixture) {
      const { structuredContent: state } = await invoke("get_window_state", fixture.target);
      assert.equal(state.pid, fixture.target.pid);
      assert.equal(state.window_id, fixture.target.window_id);
      assert.equal(state.window_title, destination);
      assert.equal(state.elements?.find(element => element.label === "Fixture state")?.value, "After navigation");
    }
    const learned = await withFixture(invoke, title, async fixture => {
      const { pid, window_id } = fixture.target;
      const actions = [
        ["list_apps", {}],
        ["list_windows", { pid, on_screen_only: false }],
        ["get_window_state", fixture.target],
        ["click", { pid, window_id, element_token: "$fixture.navigationButton", delivery_mode: "background" }],
        ["get_window_state", fixture.target],
      ];
      await writeFile(calls, JSON.stringify(actions.map(([name, input]) => ({ server: "computer", name, input }))));
      const { ms } = await chat();
      await verify(fixture);
      const id = await marker("learned");
      const disk = JSON.parse(await readFile(join(dataDir, "bots", bot.id, "saved-steps.json"), "utf8"));
      assert.equal(disk.recipes.length, 1);
      assert.equal(disk.recipes[0].id, id);
      assert.equal(await promptCount(prompts), 1);
      return { id, pid, ms, appName: disk.recipes[0].steps[0].app.name };
    });
    await writeFile(calls, "[]");
    return await withFixture(invoke, title, async fixture => {
      assert.notEqual(fixture.target.pid, learned.pid);
      const replay = await chat(`click on "Navigate fixture" in ${learned.appName}`);
      await verify(fixture);
      assert.equal(await marker("replayed"), learned.id);
      assert.equal(await promptCount(prompts), 1, "replay contacted the provider");
      return { windowsChatSavedSteps: "PASS", recordedMs: learned.ms, replayMs: replay.ms, replayApproval: replay.approval, replayApprovalObservedMs: replay.approvalObservedMs, replayProviderCalls: 0, restartedWinForms: true };
    });
  } finally {
    try { await server?.close(); }
    finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
  }
}
