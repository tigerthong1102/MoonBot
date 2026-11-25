// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SavedWorkflow } from "@/lib/skill-burger";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/api", () => ({ api: (...args: unknown[]) => fixture.api(...args) }));
const { RunWithInputs } = await import("./RunInputs");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows loading and makes only one request while opening workflow inputs", async () => {
  let resolve!: (value: unknown) => void;
  fixture.api.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const skill = { name: "fixture", summary: "Fixture", args: ["site"], everyChat: false, botId: "b" } as SavedWorkflow;
  try {
    await act(async () => root.render(createElement(RunWithInputs, { skill, onRun: vi.fn(), className: "" })));
    const button = host.querySelector("button")!;
    await act(async () => { button.click(); button.click(); });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(fixture.api).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ workflow: { args: { site: { default: "example.test" } } } }); });
    expect(button.disabled).toBe(false);
    expect(host.querySelector("input")?.value).toBe("example.test");
  } finally { act(() => root.unmount()); host.remove(); }
});
