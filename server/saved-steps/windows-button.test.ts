import { describe, expect, it } from "vitest";
import { slimResponse } from "./driver-wire.ts";
import { buildRecipe } from "./rules.ts";
import { matchWindowButton, type ComputerCaller } from "./resolve.ts";
import { runSteps } from "./replay.ts";
import { recordedWindowsDestination } from "./windows-destination.ts";

const address = { pid: 100, window_id: 7 };
const button = { role: "Button", label: "Navigate", depth: 1, element_index: 1, element_token: "s00000001:1", enabled: true };
const tree = { ...address, app_name: "Fixture", window_title: "Navigation", tree_format: "elements",
  elements_complete: true, returned_element_count: 1, total_element_count: 1, elements: [button] };
const lookup = { ...address, tree_format: "elements" };
const click = { ...address, element_token: button.element_token, delivery_mode: "background" };
const action = { effect: "unverifiable", route: "accessibility", delivery: { mode: "background" } };
const slim = (data: object, platform: NodeJS.Platform = "win32") => slimResponse({ result: { structuredContent: data } }, platform);
function record(snapshot: object = tree, args: object = click, delivery: object = action, read: object = lookup, platform: NodeJS.Platform = "win32") {
  return buildRecipe({ id: "r", now: 1, request: 'Navigate using button "Navigate" and verify window title "Destination"', journal: { complete: true, tainted: false, calls: [
    { tool: "get_window_state", arguments: { ...read }, result: slim(snapshot, platform), generation: "g" },
    { tool: "click", arguments: { ...args }, result: slim(delivery, platform), generation: "g" },
  ] } });
}

describe("Windows UIA projected window buttons", () => {
  it("saves a stable direct-child selector for a verified background click", () => {
    const built = record();
    if (!built.ok) throw Error(built.reason);
    expect(built.recipe.steps).toEqual([{ tool: "click", args: { delivery_mode: "background" }, app: { name: "Fixture" },
      window: { title: "Navigation" }, element: { role: "Button", label: "Navigate", path: [], uiaWindowChild: true } }]);
  });

  it("requires an enabled first-level button, a complete window projection and an accessibility click", () => {
    for (const change of [{ depth: 2 }, { depth: 0, parent_index: 17 }, { parent_index: 9 }, { parent_index: "0" },
      { enabled: false }, { label: "" }, { label: "Pay" }, { role: "Edit" }, { element_index: 1.5 }]) {
      expect(record({ ...tree, elements: [{ ...button, ...change }] }).ok, JSON.stringify(change)).toBe(false);
    }
    for (const change of [{ truncated: true }, { degraded: true }, { elements_complete: false }, { total_element_count: 2 },
      { filtered_element_count: 0 }, { tree_format: "markdown" }, { window_title: "" }]) {
      expect(record({ ...tree, ...change }).ok, JSON.stringify(change)).toBe(false);
    }
    for (const change of [{ delivery_mode: "foreground" }, { count: 2 }, { pid: 88 }, { window_id: 9 }, { element_index: 1 }]) {
      expect(record(tree, { ...click, ...change }).ok, JSON.stringify(change)).toBe(false);
    }
    for (const change of [{ route: "global_input" }, { effect: "refused" }, { delivery: { mode: "foreground" } }]) {
      expect(record(tree, click, { ...action, ...change }).ok).toBe(false);
    }
    expect(record(tree, click, action, { ...lookup, pid: 99 }).ok).toBe(false);
    expect(record(tree, click, action, { ...lookup, role_filter: "Button" }).ok).toBe(false);
    expect(record(tree, click, action, lookup, "darwin").ok).toBe(false);
  });

  it("identifies a uniquely named nested button when its projected parent is present", () => {
    const parent = { role: "ToolBar", label: "Navigation", depth: 2, element_index: 0, element_token: "s00000001:0" };
    const child = { ...button, depth: 3, parent_index: 0 };
    const state = { ...tree, returned_element_count: 2, total_element_count: 2, elements: [parent, child] };
    const built = record(state);
    expect(built.ok).toBe(true);
    const malformed = { ...state, elements: [parent, { ...child, parent_index: 9 }] };
    expect(record(malformed).ok).toBe(false);
    const duplicate = { ...state, returned_element_count: 3, total_element_count: 3,
      elements: [parent, child, { ...child, element_index: 2, element_token: "s00000001:2" }] };
    expect(record(duplicate).ok).toBe(false);
  });

  it("learns and replays a nested navigation only when the named tab newly appears", async () => {
    const parent = { role: "ToolBar", label: "Navigation", depth: 2, element_index: 0, element_token: "s00000001:0" };
    const child = { ...button, depth: 3, parent_index: 0 };
    const before = { ...tree, returned_element_count: 2, total_element_count: 2, elements: [parent, child] };
    const tab = { role: "TabItem", label: "Reports", depth: 2, element_index: 2, element_token: "s00000002:2" };
    const after = { ...before, returned_element_count: 3, total_element_count: 3, elements: [parent, child, tab] };
    const built = record(before);
    if (!built.ok) throw Error(built.reason);
    const recipe = { ...built.recipe, request: 'Navigate using button "Navigate" and verify tab "Reports"' };
    const journal = { complete: true, tainted: false, calls: [
      { tool: "get_window_state", arguments: lookup, result: slim(before), generation: "g" },
      { tool: "click", arguments: click, result: slim(action), generation: "g" },
      { tool: "get_window_state", arguments: lookup, result: slim(after), generation: "g" },
    ] };
    expect(recordedWindowsDestination(recipe, journal)).toBe(true);
    expect(recordedWindowsDestination(recipe, { ...journal, calls: [journal.calls[0]!, journal.calls[1]!,
      { ...journal.calls[2]!, arguments: { ...lookup, query: "Reports" } }] })).toBe(false);
    expect(recordedWindowsDestination(recipe, { ...journal, calls: [journal.calls[2]!, journal.calls[1]!, journal.calls[2]!] })).toBe(false);
    const duplicate = { ...after, returned_element_count: 4, total_element_count: 4,
      elements: [...after.elements, { ...tab, element_index: 3, element_token: "s00000002:3" }] };
    expect(recordedWindowsDestination(recipe, { ...journal, calls: [journal.calls[0]!, journal.calls[1]!,
      { ...journal.calls[2]!, result: slim(duplicate) }] })).toBe(false);
    let clicks = 0, verified = 0, startingWithTab = false, reserved = 0;
    const caller: ComputerCaller = { async call(tool) {
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: address.pid, name: tree.app_name }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ ...address, title: tree.window_title }] } };
      if (tool === "get_window_state") return { ok: true, structured: clicks || startingWithTab ? after : before };
      if (tool !== "click") throw Error(tool);
      clicks++;
      return { ok: true, structured: action };
    } };
    const outcome = await runSteps(recipe, { threadId: "thread", turnId: "turn", provider: "fixture", providerInstanceId: "fixture" },
      { caller, approval: { ask: async () => true }, publish() {}, signal: new AbortController().signal,
        windowsAttempt: { begin: () => { reserved++; return true; }, verified: () => { verified++; } } });
    expect(outcome).toEqual({ kind: "done" });
    expect({ clicks, verified, reserved }).toEqual({ clicks: 1, verified: 1, reserved: 1 });
    clicks = 0;
    startingWithTab = true;
    const alreadyThere = await runSteps(recipe, { threadId: "thread", turnId: "turn-2", provider: "fixture", providerInstanceId: "fixture" },
      { caller, approval: { ask: async () => true }, publish() {}, signal: new AbortController().signal,
        windowsAttempt: { begin: () => { reserved++; return true; }, verified: () => { verified++; } } });
    expect(alreadyThere).toMatchObject({ kind: "failed", error: expect.stringContaining("already present") });
    expect({ clicks, verified, reserved }).toEqual({ clicks: 0, verified: 1, reserved: 1 });
  });
  it("allows an unfiltered full-window read with a larger native traversal budget", () => {
    expect(record(tree, click, action, { ...lookup, timeout_ms: 30000, max_elements: 5000 }).ok).toBe(true);
    expect(record(tree, click, action, { ...lookup, timeout_ms: 30000, max_elements: 5000, max_depth: 3 }).ok).toBe(false);
  });

  it("records accessibility delivery without treating it as a destination", () => {
    expect(slim(action).structured?.background_accessibility_action).toBe(true);
    expect(slim(action).structured).not.toHaveProperty("effect");
    expect(slim({ ...action, effect: "confirmed", route: "global_input" }).structured?.background_accessibility_action).toBeUndefined();
  });

  it("reports an unverified click once and does not claim replay succeeded", async () => {
    const built = record();
    if (!built.ok) throw Error(built.reason);
    let clicks = 0;
    const caller: ComputerCaller = { async call(tool) {
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: address.pid, name: tree.app_name }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ ...address, title: tree.window_title }] } };
      if (tool === "get_window_state") return { ok: true, structured: clicks === 0 ? tree : { ...tree, window_title: "Other" } };
      if (tool !== "click") throw Error(tool);
      clicks++;
      return { ok: true, structured: action };
    } };
    const outcome = await runSteps(built.recipe, { threadId: "thread", turnId: "turn", provider: "fixture", providerInstanceId: "fixture" },
      { caller, approval: { ask: async () => true }, publish() {}, signal: new AbortController().signal, windowsAttempt: { begin: () => true, verified: () => { throw new Error("verified unexpected title"); } } });
    expect(outcome).toMatchObject({ kind: "failed", done: 0, error: expect.stringContaining("may already have reached") });
    expect(clicks).toBe(1);
  });

  it("refuses twins at any depth, duplicate addresses and a newly disabled button", () => {
    for (const other of [{ ...button, depth: 3, element_index: 5, element_token: "s00000001:5" },
      { ...button, label: "Other", element_index: 2 }, { ...button, label: "Other", element_token: "s00000001:2" },
      { ...button, role: "Window", label: "Root", element_index: 0, element_token: "s00000001:0", depth: 0 }]) {
      const state = { ...tree, returned_element_count: 2, total_element_count: 2, elements: [button, other] };
      expect(record(state).ok).toBe(false);
      expect(matchWindowButton(slim(state).structured!.elements!, button.label).ok).toBe(false);
    }
    const disabled = { ...tree, elements: [{ ...button, enabled: false }] };
    expect(matchWindowButton(slim(disabled).structured!.elements!, button.label).ok).toBe(false);
  });
});
