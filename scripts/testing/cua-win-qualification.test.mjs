import assert from "node:assert/strict";
import { test } from "vitest";
import { checkNavigationDelivery, checkWindowsContract, fixtureSnapshot } from "../cua-win-qualification.mjs";

const version = { driverVersion: "0.45.4", contractVersion: "0.8.0" };
const target = { pid: 10, window_id: 103 };
const native = (name, properties = {}) => ({ name, inputSchema: { type: "object", properties } });
const shape = { type: "integer" };
const tools = [
  native("list_apps"), native("list_windows", { pid: shape, on_screen_only: { type: "boolean" } }),
  native("get_window_state", { pid: shape, window_id: shape, include_screenshot: { type: "boolean" }, tree_format: { enum: ["markdown", "elements", "both"] } }),
  native("click", { pid: shape, window_id: shape, element_token: { type: "string" }, delivery_mode: { enum: ["background", "foreground"] } }),
];

function sample() {
  return { content: [{ type: "text", text: "fixture snapshot" }], structuredContent: {
    ...target, elements_complete: true, total_element_count: 2, returned_element_count: 2,
    elements: [
      { label: "Navigate fixture", role: "Button", element_index: 1, enabled: true, element_token: "s00000001:1", depth: 1 },
      { label: "Fixture state", role: "Edit", element_index: 2, value: "Before navigation", depth: 1 },
    ],
  } };
}

test("requires the pinned Windows tool contract and rejects portable-only or ambiguous definitions", () => {
  assert.doesNotThrow(() => checkWindowsContract(version, tools));
  assert.throws(() => checkWindowsContract({ ...version, driverVersion: "0.41.3" }, tools), /binary version/);
  assert.throws(() => checkWindowsContract({ ...version, contractVersion: "0.9.0" }, tools), /contract version/);
  assert.throws(() => checkWindowsContract(version, [...tools, tools[0]]), /duplicate/);
  assert.throws(() => checkWindowsContract(version, [...tools.slice(0, 3), native("click", { target: shape })]), /click.pid/);
  const foreground = structuredClone(tools);
  foreground.at(-1).inputSchema.properties.delivery_mode.enum = ["foreground"];
  assert.throws(() => checkWindowsContract(version, foreground), /background delivery/);
});

test("accepts uniquely resolved actionable controls with fresh token and an observable value", () => {
  assert.deepEqual(fixtureSnapshot(sample(), target), { token: "s00000001:1", value: "Before navigation" });
});

test("rejects wrong-window, incomplete, degraded, stale-shaped, and ambiguous snapshots", () => {
  const badStates = [
    (response, tree) => { tree.pid++; },
    (response, tree) => { tree.window_id++; },
    (response, tree) => { tree.total_element_count++; },
    (response, tree) => { tree.degraded = true; },
    (response, tree) => { tree.elements_complete = false; },
    (response, tree) => { tree.truncated = true; },
    (response, tree) => { tree.elements[0].element_token = "s1-e1"; },
    (response, tree) => { tree.elements[0].enabled = false; },
    (response, tree) => { delete tree.elements[1].value; },
    (response, tree) => { tree.elements[1].element_index = 1; },
    (response, tree) => { delete tree.elements[0].label; },
    (response, tree) => { tree.elements[1].label = tree.elements[0].label; },
    (response, tree) => { response.content.push({ type: "image", data: "x" }); },
  ];
  for (const modify of badStates) {
    const response = sample();
    modify(response, response.structuredContent);
    assert.throws(() => fixtureSnapshot(response, target));
  }
});

test("requires canonical accessibility and background delivery evidence before read-back", () => {
  const result = { structuredContent: { effect: "unverifiable", route: "accessibility", delivery: { mode: "background" } } };
  assert.doesNotThrow(() => checkNavigationDelivery(result));
  for (const mutation of [
    { route: "synthetic_events" },
    { route: undefined, path: "ax" },
    { delivery: { mode: "foreground" } },
    { effect: "refused" },
    { effect: "partial" },
  ]) {
    assert.throws(() => checkNavigationDelivery({ structuredContent: { ...result.structuredContent, ...mutation } }));
  }
});
