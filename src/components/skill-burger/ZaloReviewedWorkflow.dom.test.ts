// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SkillBurgersPage } from "./SkillBurgersPage";
const fixture = vi.hoisted(() => ({
  skill: { name: "fixture", summary: "Verify balances", botId: "a", sha256: "old", everyChat: false, layers: [{ label: "Compare totals" }] },
  reviewed: { botId: "a", threadId: "t", sha256: "old", name: "fixture" }, threadId: "t", dispatch: vi.fn(),
}));
vi.mock("@/lib/skill-burger", async load => ({ ...await load<object>(), useSavedBurgers: () => ({ skills: [fixture.skill] }) }));
vi.mock("@/state/store-select", () => ({
  useStoreDispatch: () => fixture.dispatch,
  useStoreSelector: (read: (state: unknown) => unknown) => read({ reviewedWorkflow: fixture.reviewed, bots: [{ id: "a", threadId: fixture.threadId }] }),
}));
vi.mock("./SavedWorkflowsCard", () => ({ useBurgerRemoval: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("allows inspection of the approved private revision, has no Run action, and withdraws the preview after replacement or thread change", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const draw = () => act(async () => root.render(createElement(SkillBurgersPage)));
  try {
    await draw();
    expect(host.textContent).toContain("Compare totals");
    expect(host.querySelector("[data-run-burger]")).toBeNull();
    fixture.skill.sha256 = "new"; await draw();
    expect(host.textContent).toContain("workflow changed");
    expect(host.textContent).not.toContain("Compare totals");
    fixture.skill.sha256 = "old"; fixture.threadId = "other"; await draw();
    expect(host.textContent).not.toContain("Compare totals");
  } finally { act(() => root.unmount()); }
});
