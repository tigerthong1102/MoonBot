import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";

export async function qualifyLinuxChat({ driver, driverProcess, socketPath, sandbox, fixtureTitle, startFixture, rpc, session, stop, until, multi = false, wayland = false }) {
  const binary = realpathSync(driver);
  const stat = statSync(binary, { bigint: true });
  const fileIdentity = Object.fromEntries(["dev", "ino", "uid", "gid", "mode", "size", "mtimeNs", "ctimeNs"].map(key => [key, String(stat[key])]));
  const descriptor = {
    schemaVersion: 1, mode: wayland ? "linux-wayland-gnome-supervised" : "linux-x11-supervised", platform: "linux", session: wayland ? "wayland" : "x11", enabled: true, status: "ready",
    ...(wayland ? { compositor: "gnome-mutter" } : {}),
    ownerPid: process.pid, generation: randomUUID(),
    driver: { path: binary, version: "0.41.3", source: "environment", manifestSchema: "1", fileIdentity },
    daemon: { socketPath, pid: driverProcess.pid, contractVersion: "0.8.0", toolsListSchemaVersion: "1", capabilityVersion: "1", mcpProtocolVersion: "2025-06-18" },
    mcp: { command: binary, args: ["mcp", "--embedded", "--socket", socketPath], env: {
      CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_HOST_BUNDLE_ID: "ai.startupbot.desktop", CUA_DRIVER_RS_UPDATE_CHECK: "false", CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
      ...(wayland ? { CUA_DRIVER_RS_ENABLE_WAYLAND: "1" } : {}),
    } },
    toolNames: ["click", "get_window_state", "list_apps", "type_text"], doctorWarnings: [],
  };
  const grant = join(sandbox, "desktop.json"), calls = join(sandbox, "chat-calls.json"), prompts = join(sandbox, "prompts.jsonl");
  await writeFile(grant, JSON.stringify(descriptor), { mode: 0o600 });
  await writeFile(calls, "[]", { mode: 0o600 });
  await writeFile(prompts, "", { mode: 0o600 });
  let server, fixture;
  try {
    server = await launchVerificationServer({ OMB_TEST_DESKTOP_CUA_CONNECTION: grant,
      FAKE_CLAUDE_LINUX_NAVIGATION_FIXTURE: "1", FAKE_CLAUDE_TOOL_CALLS_FILE: calls, FAKE_CLAUDE_PROMPTS: prompts,
      FAKE_CLAUDE_REPLIES: '["Fixture navigation completed."]' }, AbortSignal.timeout(60000));
    const { url, dataDir } = server.info;
    const request = async (path, method = "GET", body) => {
      const response = await fetch(url + path, { method, headers: { origin: url, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
      assert.ok(response.ok, `${method} ${path}: ${response.status}`);
      return response.json();
    };
    const config = await request("/api/config", "PATCH", { features: { savedSteps: true } });
    assert.equal(config.features?.savedStepsHere, true);
    const run = (...args) => runControlOmb([...args, "--url", url]);
    const { bot } = await run("new-bot", "--name", "Linux Navigation Fixture");
    const args = ["--bot", bot.id, "--task", bot.activeTaskId];
    await request(`/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, "PATCH", { surface: "local" });
    const transcript = async () => (await request(`/api/threads/${bot.activeTaskId}/messages?limit=100`)).messages;
    const text = multi
      ? 'Navigate using button "Reports" and verify window title "Reports screen", then button "Open report" and verify window title "StartupBot Linux destination"'
      : 'Navigate using button "Open report" and verify window title "StartupBot Linux destination"';
    const promptCount = async () => (await readFile(prompts, "utf8")).trim().split("\n").filter(Boolean).length;
    const open = async () => {
      fixture = startFixture();
      const window = await until(async () => {
        const result = await rpc("tools/call", { name: "list_windows", arguments: { session, pid: fixture.pid } });
        return result.structuredContent?.windows?.find(row => row.title === fixtureTitle);
      }, "GTK chat fixture", 20000);
      await delay(500);
      return { pid: fixture.pid, window_id: window.window_id, tree_format: "elements", include_screenshot: false };
    };
    const target = await open();
    const click = ["click", { pid: target.pid, window_id: target.window_id, element_token: "$fixture.navigationButton", delivery_mode: "background" }];
    const actions = [["list_apps", {}], ["list_windows", { pid: target.pid, on_screen_only: false }], ["get_window_state", target],
      click, ["get_window_state", target], ...(multi ? [click, ["get_window_state", target]] : [])];
    await writeFile(calls, JSON.stringify(actions.map(([name, input]) => ({ server: "computer", name, input }))));
    await run("send", ...args, "--text", text);
    assert.equal((await run("wait", ...args, "--timeout", "120")).status, "settled");
    const learned = (await transcript()).filter(message => message.savedSteps?.learned);
    assert.equal(learned.length, 1, "chat did not mark learned steps");
    const id = learned[0].savedSteps.recipeId;
    const disk = JSON.parse(await readFile(join(dataDir, "bots", bot.id, "saved-steps.json"), "utf8"));
    assert.equal(disk.recipes[0].id, id);
    assert.equal(await promptCount(), 1);
    const firstPid = fixture.pid;
    await stop(fixture);
    await until(async () => fixture.exitCode !== null || fixture.signalCode !== null, "GTK chat fixture to exit", 5000);
    const reopened = await open();
    assert.notEqual(reopened.pid, firstPid);
    await writeFile(calls, "[]");
    await run("send", ...args, "--text", text);
    assert.equal((await run("wait", ...args, "--timeout", "120")).status, "settled");
    const replayed = (await transcript()).filter(message => message.savedSteps?.replayed);
    assert.equal(replayed.length, 1, "chat did not mark replayed steps");
    assert.equal(replayed[0].savedSteps.recipeId, id);
    assert.equal(await promptCount(), 1, "replay contacted the AI provider");
    const final = await rpc("tools/call", { name: "get_window_state", arguments: { ...reopened, session } });
    assert.equal(final.structuredContent?.window_title, "StartupBot Linux destination");
    console.log("LINUX_CHAT_SAVED_STEPS_PASS", JSON.stringify({ session: wayland ? "gnome-wayland" : "x11", learned: true, saved: true, restarted: true, replayed: true, steps: multi ? 2 : 1, extraProviderCalls: 0 }));
  } finally {
    if (fixture) {
      await stop(fixture);
      await until(async () => fixture.exitCode !== null || fixture.signalCode !== null, "GTK chat fixture to exit", 5000);
    }
    await server?.close();
  }
}


