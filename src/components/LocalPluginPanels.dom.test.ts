// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { LocalPluginPanels } from "./LocalPluginPanels";
import { readPanelManifest } from "@/lib/panel-plugins/manifest";
const panel = { id: "sample", title: "Orders", ui: "static", rows: [{ label: "Pending", value: "<img src=x>" }] };
const manifest = { manifestVersion: 2, pluginApi: 1, execution: "sandboxed-ui", id: "demo", name: "Inventory", version: "1.0.1", capabilities: [], contributes: { panels: [panel] } };
it.each([{ id: "constructor" }, { capabilities: ["terminal"] }, { entry: "run.js" }, { contributes: { panels: [panel, panel] } }, { description: "x".repeat(66000) }])("refuses unsupported manifests", (fields) => {
  expect(() => readPanelManifest(JSON.stringify({ ...manifest, ...fields }))).toThrow();
});
it("opens, retains a previous panel on invalid replacement and removes it", async () => {
  const view = document.createElement("div");
  const root = createRoot(view);
  await act(async () => root.render(createElement(LocalPluginPanels)));
  const input = view.querySelector("input")!;
  async function select(value: unknown) {
    const file = { size: 500, text: async () => JSON.stringify(value) };
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  try {
    await select(manifest);
    expect(view.querySelector("dd")?.textContent).toBe("<img src=x>");
    expect(view.querySelector("img")).toBeNull();
    await select({ ...manifest, entry: "file.js" });
    expect(view.querySelector("[role=alert]")).toBeTruthy();
    expect(view.querySelector("h4")?.textContent).toBe("Orders");
    await select({ ...manifest, version: "2.0.0" });
    expect(view.querySelectorAll("h4")).toHaveLength(1);
    expect(view.querySelector("h3")?.textContent).toContain("2.0.0");
    await act(async () => view.querySelector("button")!.click());
    expect(view.querySelector("h4")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
