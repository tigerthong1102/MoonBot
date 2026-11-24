import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slimResponse } from "./driver-wire.ts";
import { buildRecipe } from "./rules.ts";
import { expectedLinuxDestinations, linuxDestinations, recordedLinuxDestinations } from "./linux-navigation.ts";
import { runSteps, WINDOWS_UNCERTAIN } from "./replay.ts";
import type { ComputerCaller } from "./resolve.ts";
import { RecipeStore } from "./store.ts";

const text = 'Navigate using button "Reports" and verify window title "Reports screen", then button "Open report" and verify window title "Report screen"';
const address = { pid: 100, window_id: 7 };
const read = { ...address, tree_format: "elements", include_screenshot: false };
const row = (label: string, token: string) => ({ role: "push button", label, depth: 1, element_index: 0, element_token: token, enabled: true });
const state = (title: string, button: string, token: string) => ({ ...address, app_name: "gtk-window", window_title: title,
  tree_format: "elements", elements_complete: true, total_element_count: 1, returned_element_count: 1, elements: [row(button, token)] });
const first = state("Start", "Reports", "s00000001:0");
const second = state("Reports screen", "Open report", "s00000002:0");
const last = state("Report screen", "Close report", "s00000003:0");
const delivery = { effect: "unverifiable", route: "accessibility", delivery: { mode: "background" } };
const entry = (tool: string, args: object, data: object) => ({ tool, arguments: { ...args }, result: slimResponse({ result: { structuredContent: data } }, "linux"), generation: "g" });
const journal = () => ({ complete: true, tainted: false, calls: [
  entry("list_apps", {}, { apps: [{ pid: 100, name: "fixture", running: true }] }),
  entry("get_window_state", read, first), entry("click", { ...address, element_token: "s00000001:0", delivery_mode: "background" }, delivery),
  entry("get_window_state", read, second), entry("click", { ...address, element_token: "s00000002:0", delivery_mode: "background" }, delivery),
  entry("get_window_state", read, last),
] });
const build = () => buildRecipe({ request: text, id: "r", now: 1, platform: "linux", journal: journal() });

describe("Linux multi-step navigation", () => {
  it("parses explicit English and Vietnamese sequences without accepting extra commands", () => {
    expect(linuxDestinations(text)).toEqual([{ button: "Reports", title: "Reports screen" }, { button: "Open report", title: "Report screen" }]);
    expect(linuxDestinations('Điều hướng bằng nút "A" và xác minh tiêu đề cửa sổ "B", sau đó nút "C" và xác minh tiêu đề cửa sổ "D"')).toHaveLength(2);
    expect(linuxDestinations(text + ", then delete everything")).toBeUndefined();
  });

  it("requires a complete, ordered recording of each explicitly named transition", () => {
    const result = build();
    if (!result.ok) throw new Error(result.reason);
    expect(expectedLinuxDestinations(result.recipe)).toHaveLength(2);
    expect(recordedLinuxDestinations(result.recipe, journal())).toBe(true);
    const missing = journal(); missing.calls.pop();
    expect(recordedLinuxDestinations(result.recipe, missing)).toBe(false);
    const changedPid = journal(); Object.assign(changedPid.calls[4]!.arguments, { pid: 101 });
    expect(recordedLinuxDestinations(result.recipe, changedPid)).toBe(false);
    const wrong = { ...result.recipe, steps: [result.recipe.steps[0]!, { ...result.recipe.steps[1]!, window: { title: "Other" } }] };
    expect(expectedLinuxDestinations(wrong)).toBeUndefined();
  });

  it("reserves once and clears only after both fresh actions reach their destinations", async () => {
    const result = build(); if (!result.ok) throw new Error(result.reason);
    let current = first; let clicks = 0; let begins = 0; let verified = 0;
    const caller: ComputerCaller = { async call(tool) {
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 100, name: "fixture" }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ ...address, title: current.window_title }] } };
      if (tool === "get_window_state") return { ok: true, structured: current };
      if (tool === "click") { current = ++clicks === 1 ? second : last; return { ok: true, structured: delivery }; }
      throw new Error(tool);
    } };
    const outcome = await runSteps(result.recipe, { threadId: "t", turnId: "r", provider: "fake", providerInstanceId: "fake" }, {
      caller, approval: { ask: async () => true }, publish: () => {}, signal: new AbortController().signal,
      windowsAttempt: { begin: () => { begins++; return true; }, verified: () => { verified++; } },
    });
    expect(outcome).toEqual({ kind: "done" });
    expect({ clicks, begins, verified }).toEqual({ clicks: 2, begins: 1, verified: 1 });
  });

  it("keeps the reservation and never executes a second click after a partial failure", async () => {
    const result = build(); if (!result.ok) throw new Error(result.reason);
    let current = first; let clicks = 0; let verified = 0;
    const caller: ComputerCaller = { async call(tool) {
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 100, name: "fixture" }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ ...address, title: current.window_title }] } };
      if (tool === "get_window_state") return { ok: true, structured: current };
      if (tool === "click") { clicks++; current = second; return { ok: true, structured: delivery }; }
      throw new Error(tool);
    } };
    let approvals = 0;
    const outcome = await runSteps(result.recipe, { threadId: "t", turnId: "r", provider: "fake", providerInstanceId: "fake" }, {
      caller, approval: { ask: async () => ++approvals === 1 }, publish: () => {}, signal: new AbortController().signal,
      windowsAttempt: { begin: () => true, verified: () => { verified++; } },
    });
    expect(outcome).toMatchObject({ kind: "failed", error: WINDOWS_UNCERTAIN });
    expect(clicks).toBe(1);
    expect(verified).toBe(0);
  });

  it("keeps a partial run blocked across store restarts", async () => {
    const result = build(); if (!result.ok) throw new Error(result.reason);
    const temp = mkdtempSync(join(tmpdir(), "saved-linux-multi-"));
    try {
      const store = new RecipeStore({ folder: () => temp });
      expect(store.save("bot", result.recipe)).toBe(true);
      expect(store.beginWindowsAttempt("bot", result.recipe.key, result.recipe.id)).toBe(true);
      const restarted = new RecipeStore({ folder: () => temp });
      expect(restarted.windowsPending("bot", result.recipe.key)).toBe(true);
      expect(restarted.beginWindowsAttempt("bot", result.recipe.key, result.recipe.id)).toBe(false);
      expect(restarted.save("bot", result.recipe)).toBe(false);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});

