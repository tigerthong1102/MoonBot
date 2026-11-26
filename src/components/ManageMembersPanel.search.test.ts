// @vitest-environment happy-dom
import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ bots: [] as Bot[], dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: fixture.bots }, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
import { ManageMembersPanel } from "./ManageMembersPanel";

it("filters local and linked members together without changing membership", () => {
  fixture.bots = [{ id: "local", name: "Atlas", threadId: "local-thread", color: "blue", modelSelection: { instanceId: "fake", model: "fake" } } as Bot];
  const far = { id: "link-0000abcd-nova", name: "Nova", place: "Cloud", state: "ok" as const };
  const group = { id: "group", name: "Group", threadId: "group-thread", memberIds: ["local", far.id], farMembers: [far] } as Group;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ManageMembersPanel, { group, onClose: () => {}, triggerRef: createRef<HTMLButtonElement>() })));
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const search = (value: string) => flushSync(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    search("Nova");
    expect(host.querySelector('[data-far-member]')?.textContent).toContain("Nova");
    expect(host.textContent).not.toContain("No results");
    expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
    search("not a member");
    expect(host.querySelector('[data-far-member]')).toBeNull();
    expect(host.textContent).toContain("No results");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
