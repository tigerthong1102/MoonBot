import { describe, expect, it } from "vitest";
import { slimResponse } from "./driver-wire.ts";
import { buildRecipe } from "./rules.ts";
import { recordedWindowsDestination } from "./windows-destination.ts";
import { runSteps } from "./replay.ts";
import type { ComputerCaller } from "./resolve.ts";

const request = 'Navigate using button "Open report" and verify window title "Destination"';
const address = { pid: 100, window_id: 7 };
const read = { ...address, tree_format: "elements", include_screenshot: false };
const button = { role: "push button", label: "Open report", depth: 1, element_index: 0, element_token: "s00000001:0", enabled: true };
const tree = { ...address, app_name: "gtk-window", window_title: "Start", tree_format: "elements", elements_complete: true,
  returned_element_count: 1, total_element_count: 1, elements: [button] };
const click = { ...address, element_token: button.element_token, delivery_mode: "background" };
const delivery = { effect: "unverifiable", route: "accessibility", delivery: { mode: "background" } };
const slim = (data: object) => slimResponse({ result: { structuredContent: data } }, "linux");
const entry = (tool: string, args: object, data: object) => ({ tool, arguments: { ...args }, result: slim(data), generation: "g" });
const calls = (state = tree, action = delivery) => [
  entry("list_apps", {}, { apps: [{ pid: 100, name: "fixture", running: true }] }),
  entry("get_window_state", read, state), entry("click", click, action),
  entry("get_window_state", read, { ...tree, window_title: "Destination" }),
];
const build = (journalCalls = calls()) => buildRecipe({ request, id: "linux", now: 1, platform: "linux", journal: { calls: journalCalls, complete: true, tainted: false } });

describe("Linux AT-SPI saved navigation", () => {
  it("records the process identity and verifies a changed window title", () => {
    const result = build();
    if (!result.ok) throw new Error(result.reason);
    expect(result.recipe.steps[0]).toMatchObject({ app: { name: "fixture" }, window: { title: "Start" }, element: { linuxWindowChild: true } });
    expect(recordedWindowsDestination(result.recipe, { calls: calls(), complete: true, tainted: false })).toBe(true);
  });

  it("uses the process name when the window was listed before the app", () => {
    const journal = calls();
    journal.unshift(entry("list_windows", {}, { windows: [{ ...address, title: "Start", app_name: "gtk-window" }] }));
    const result = build(journal);
    if (!result.ok) throw new Error(result.reason);
    expect(result.recipe.steps[0]?.app).toEqual({ name: "fixture" });
  });

  it("rejects incomplete or ambiguous observations, unlisted apps and unverified delivery", () => {
    expect(build(calls().slice(1)).ok).toBe(false);
    expect(build(calls({ ...tree, elements_complete: false })).ok).toBe(false);
    expect(build(calls({ ...tree, elements: [{ ...button, enabled: false }] })).ok).toBe(false);
    expect(build(calls({ ...tree, total_element_count: 2, returned_element_count: 2, elements: [button, { ...button, element_index: 1, element_token: "s00000001:1" }] })).ok).toBe(false);
    expect(build(calls(tree, { ...delivery, route: "global_input" })).ok).toBe(false);
    const result = build();
    if (!result.ok) throw new Error(result.reason);
    expect(recordedWindowsDestination(result.recipe, { calls: calls().slice(0, 3), complete: true, tainted: false })).toBe(false);
  });

  it("replays against freshly resolved process and window, verifying the destination", async () => {
    const result = build();
    if (!result.ok) throw new Error(result.reason);
    let title = "Start";
    let clicks = 0;
    let verified = false;
    const caller: ComputerCaller = { async call(tool) {
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 100, name: "fixture" }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ ...address, title }] } };
      if (tool === "get_window_state") return { ok: true, structured: { ...tree, window_title: title } };
      if (tool === "click") { clicks++; title = "Destination"; return { ok: true, structured: delivery }; }
      throw new Error(tool);
    } };
    const outcome = await runSteps(result.recipe, { threadId: "t", turnId: "turn", provider: "fake", providerInstanceId: "fake" }, {
      caller, approval: { ask: async () => true }, publish: () => {}, signal: new AbortController().signal,
      windowsAttempt: { begin: () => true, verified: () => { verified = true; } },
    });
    expect(outcome).toEqual({ kind: "done" });
    expect(clicks).toBe(1);
    expect(verified).toBe(true);
  });

  it("does not retry or clear the reservation when click delivery is uncertain", async () => {
    const result = build();
    if (!result.ok) throw new Error(result.reason);
    let clicks = 0;
    let reserved = false;
    let verified = false;
    const caller: ComputerCaller = { async call(tool) {
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 100, name: "fixture" }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ ...address, title: "Start" }] } };
      if (tool === "get_window_state") return { ok: true, structured: tree };
      if (tool === "click") { clicks++; return { ok: false, error: "connection lost" }; }
      throw new Error(tool);
    } };
    const outcome = await runSteps(result.recipe, { threadId: "t", turnId: "turn", provider: "fake", providerInstanceId: "fake" }, {
      caller, approval: { ask: async () => true }, publish: () => {}, signal: new AbortController().signal,
      windowsAttempt: { begin: () => { reserved = true; return true; }, verified: () => { verified = true; } },
    });
    expect(outcome.kind).toBe("failed");
    expect(clicks).toBe(1);
    expect(reserved).toBe(true);
    expect(verified).toBe(false);
  });
});

