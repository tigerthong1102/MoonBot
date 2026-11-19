import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { elementPath, slimResponse, treeDegraded, wholeTree } from "../server/saved-steps/driver-wire.ts";
import { matchWindow } from "../server/saved-steps/resolve.ts";
import { buildRecipe } from "../server/saved-steps/rules.ts";

const PIN = "0.45.4";
const CONTRACT = "0.8.0";
const TOKEN = /^s[0-9a-f]{8}:\d+$/u;
const FIELDS = {
  list_apps: [],
  list_windows: ["pid", "on_screen_only"],
  get_window_state: ["pid", "window_id", "include_screenshot", "tree_format"],
  click: ["pid", "window_id", "element_token", "delivery_mode"],
};

export function checkWindowsContract(connection, tools) {
  assert.equal(connection.driverVersion, PIN, "unexpected CUA binary version");
  assert.equal(connection.contractVersion, CONTRACT, "unexpected CUA contract version");
  assert.ok(Array.isArray(tools), "missing native tool list");
  for (const [name, fields] of Object.entries(FIELDS)) {
    const matches = tools.filter((tool) => tool?.name === name);
    assert.equal(matches.length, 1, "missing or duplicate native MCP tool " + name);
    const schema = matches[0].inputSchema;
    assert.equal(schema?.type, "object", "wrong input schema for " + name);
    for (const field of fields) assert.ok(schema.properties?.[field], "missing " + name + "." + field);
  }
  const click = tools.find((tool) => tool.name === "click").inputSchema.properties;
  assert.ok(click.delivery_mode.enum?.includes("background"), "background delivery is unavailable");
  const snapshot = tools.find((tool) => tool.name === "get_window_state").inputSchema.properties;
  assert.ok(snapshot.tree_format.enum?.includes("elements"), "structured UIA view is unavailable");
}

export function fixtureSnapshot(result, target) {
  assert.ok(Array.isArray(result?.content) && result.content.every((item) => item?.type === "text") && !result.isError, "expected screenshot-free UIA result");
  const tree = result.structuredContent;
  assert.equal(tree?.pid, target.pid, "snapshot PID mismatch");
  assert.equal(tree?.window_id, target.window_id, "snapshot window mismatch");
  const treeEvidence = {
    complete: tree.elements_complete === true, degraded: treeDegraded(tree), truncated: tree.truncated === true,
    elements: Array.isArray(tree.elements) ? tree.elements.length : null,
    reported: Number.isSafeInteger(tree.total_element_count) ? tree.total_element_count : null,
  };
  assert.ok(Array.isArray(tree.elements) && wholeTree(tree) && !treeDegraded(tree) && !tree.refusal,
    "snapshot is partial or degraded " + JSON.stringify(treeEvidence));
  assert.ok(tree.elements.every((row) => row && Number.isSafeInteger(row.element_index) && typeof row.role === "string"), "invalid UIA row");
  assert.equal(new Set(tree.elements.map((row) => row.element_index)).size, tree.elements.length, "duplicate UIA index");
  assert.equal(new Set(tree.elements.filter((row) => row.element_token).map((row) => row.element_token)).size,
    tree.elements.filter((row) => row.element_token).length, "duplicate UIA token");
  function unique(label) {
    const rows = tree.elements.filter((row) => row.label === label);
    assert.equal(rows.length, 1, "missing or ambiguous fixture selector " + label);
    return rows[0];
  }
  const button = unique("Navigate fixture");
  assert.equal(button.role.toLowerCase(), "button", "unexpected navigation role");
  assert.ok(button.enabled === true && TOKEN.test(button.element_token ?? ""), "button is disabled or has no snapshot token");
  const state = unique("Fixture state");
  assert.equal(state.role.toLowerCase(), "edit", "unexpected fixture state role");
  assert.ok(typeof state.value === "string" && state.value.length > 0, "UIA value unavailable");
  return { token: button.element_token, value: state.value };
}

function structured(result) {
  assert.ok(result && !result.isError && result.structuredContent && !result.structuredContent.refusal,
    "MCP lookup refused or missing structured content");
  return result.structuredContent;
}

function readTarget(pid, window_id) {
  return { pid, window_id, include_screenshot: false, tree_format: "elements" };
}

async function waitFor(get, accept, message) {
  const deadline = Date.now() + 7_500;
  while (Date.now() < deadline) {
    const value = await get();
    if (accept(value)) return value;
    await delay(125);
  }
  throw new Error(typeof message === "function" ? message() : message);
}

export function checkNavigationDelivery(result) {
  const action = structured(result);
  assert.equal(action.route, "accessibility", "driver used a non-accessibility route");
  assert.equal(action.delivery?.mode, "background", "driver used a non-background mode");
  assert.ok(["confirmed", "unverifiable"].includes(action.effect), "unexpected navigation delivery effect");
}

async function exerciseFixture(call, title, navigation) {
  assert.equal(process.env.OMB_CUA_ISOLATED_DESKTOP, "1", "private desktop confirmation is required");
  const fixturePath = resolve(import.meta.dirname, "../dist-native/cua-win32-x64/cua-win-navigation-fixture.exe");
  const fixture = spawn(fixturePath, [title], { stdio: "ignore" });
  const exited = once(fixture, "exit");
  void exited.catch(() => {});
  try {
    await once(fixture, "spawn");
    const pid = fixture.pid;
    let ownWindowCount = 0;
    const discovered = await waitFor(async () => {
      assert.equal(fixture.exitCode, null, "WinForms fixture exited before discovery (4 means the desktop is not private)");
      const list = structured(await call("list_windows", { pid, on_screen_only: false }));
      ownWindowCount = Array.isArray(list.windows) ? list.windows.filter((window) => window?.pid === pid).length : -1;
      const window = matchWindow(list.windows, pid, { title });
      assert.notEqual(window.ok ? "" : window.reason, "ambiguous", "duplicate fixture window");
      return window.ok ? { target: readTarget(pid, window.value), row: list.windows.find((entry) => entry.window_id === window.value) } : null;
    }, Boolean, () => "fixture window not found (windows for launched PID: " + ownWindowCount + ")");
    const { target, row } = discovered;
    const apps = structured(await call("list_apps", {})).apps;
    const ownedApps = Array.isArray(apps) ? apps.filter((app) => app?.pid === pid && app.running && typeof app.name === "string") : [];
    assert.equal(ownedApps.length, 1, "fixture app identity is unavailable or ambiguous");

    const snapshot = async () => {
      const raw = await call("get_window_state", target);
      return { raw, ...fixtureSnapshot(raw, target) };
    };
    const first = await snapshot();
    const current = await snapshot();
    assert.equal(current.value, "Before navigation", "fixture is not at its starting screen");
    assert.notEqual(first.token, current.token, "snapshot token did not rotate");

    const clickArgs = (token) => ({ pid, window_id: target.window_id, element_token: token, delivery_mode: "background" });
    const stale = await call("click", clickArgs(first.token));
    assert.ok(stale?.isError === true || stale?.structuredContent?.effect === "refused", "driver accepted a stale token");
    const fresh = await snapshot();
    assert.equal(fresh.value, "Before navigation", "stale token changed the fixture");
    const verify = () => waitFor(snapshot, (state) => state.value === "After navigation", "navigation postcondition was not observed");
    const args = clickArgs(fresh.token);
    const action = await call("click", args);
    checkNavigationDelivery(action);
    const after = await verify();
    return navigation ? navigation({ target, fresh, args, action, after, window: row, app: ownedApps[0] }) : undefined;
  } finally {
    if (fixture.pid && fixture.exitCode === null && fixture.signalCode === null) {
      fixture.kill();
      await exited;
    }
  }
}

function journalEntry(tool, args, result) {
  return { tool, arguments: args, result: slimResponse({ result }), generation: "capture" };
}

function assessRecording({ target, fresh, args, action, after, window, app }) {
  const calls = [
    journalEntry("list_apps", {}, { structuredContent: { apps: [app] } }),
    journalEntry("list_windows", { pid: target.pid }, { structuredContent: { windows: [window] } }),
    journalEntry("get_window_state", target, fresh.raw),
    journalEntry("click", args, action),
    journalEntry("get_window_state", target, after.raw),
  ];
  const built = buildRecipe({
    request: "Navigate the qualification fixture", journal: { calls, complete: true, tainted: false },
    id: randomUUID(), now: Date.now(),
  });
  if (built.ok) return { status: "UNVERIFIED", reason: "capture candidate requires replay qualification" };
  const rows = fresh.raw.structuredContent.elements;
  const chosen = rows.find((row) => row.element_token === fresh.token);
  return {
    status: "BLOCKED", reason: built.reason, knownSelectorPath: elementPath(rows, chosen) !== null,
    depth: chosen.depth, hasParentIndex: chosen.parent_index !== undefined,
  };
}

export async function qualifyNavigation(invoke) {
  const title = "StartupBot CUA qualification " + randomUUID();
  const metrics = [];
  const started = performance.now();
  async function call(tool, args) {
    const before = performance.now();
    try { return await invoke(tool, args); }
    finally { metrics.push({ tool, elapsedMs: Math.round(performance.now() - before) }); }
  }
  const savedSteps = await exerciseFixture(call, title, assessRecording);
  await exerciseFixture(call, title);
  return {
    driver: PIN, contract: CONTRACT, fixture: "WinForms", navigationRounds: 2, evidence: "UIA read-back",
    savedSteps, aiCalls: 0, cuaCalls: metrics.length, elapsedMs: Math.round(performance.now() - started), metrics,
  };
}
