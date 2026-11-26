// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/api", () => ({ api: (...args: unknown[]) => fixture.api(...args) }));
const { useRunnable } = await import("@/lib/skill-burger");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps the newest workflow when an older request completes later", async () => {
  const replies: Array<(value: unknown) => void> = [];
  fixture.api.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
  function View() { const value = useRunnable("fixture", "bot"); return createElement("p", null, value?.workflow.summary); }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(View)));
    await act(async () => window.dispatchEvent(new Event("omb:skill-burgers-changed")));
    expect(replies).toHaveLength(2);
    await act(async () => { replies[1]!({ workflow: { summary: "New" }, everyChat: false }); });
    await act(async () => { replies[0]!({ workflow: { summary: "Old" }, everyChat: false }); });
    expect(host.textContent).toBe("New");
  } finally { act(() => root.unmount()); host.remove(); }
});

it("refreshes the displayed workflow when an edit changes its revision", async () => {
  fixture.api.mockResolvedValueOnce({ workflow: { summary: "Before" }, everyChat: false }).mockResolvedValueOnce({ workflow: { summary: "After" }, everyChat: false });
  function View({ revision }: { revision: string }) { const value = useRunnable("fixture", "bot", revision); return createElement("p", null, value?.workflow.summary); }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(View, { revision: "edit-1" })));
    expect(host.textContent).toBe("Before");
    await act(async () => root.render(createElement(View, { revision: "edit-2" })));
    expect(host.textContent).toBe("After");
  } finally { act(() => root.unmount()); host.remove(); }
});
