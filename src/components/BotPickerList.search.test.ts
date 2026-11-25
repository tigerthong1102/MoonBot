// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { botUsername } from "../../shared/bot-username";
import { BotPickerList } from "./BotPickerList";

const clipboard = vi.hoisted(() => vi.fn(async (_text: string) => "copied" as const));
vi.mock("@/lib/clipboard-write", () => ({ copyText: clipboard }));

it("finds a bot by its distinct username and selects its ID", async () => {
  const bots = [{ id: "first", name: "Scout" }, { id: "second", name: "Scout" }] as Bot[];
  const toggle = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(BotPickerList, { bots, picked: new Set<string>(), onToggle: toggle, emptyHint: "Empty" })));
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => { setter.call(search, `@${botUsername("second")}`); search.dispatchEvent(new Event("input", { bubbles: true })); });
    const matches = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(matches).toHaveLength(1);
    flushSync(() => host.querySelector<HTMLButtonElement>(`button[aria-label$="@${botUsername("second")}"]:not([role])`)!.click());
    await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith(`@${botUsername("second")}`));
    expect(toggle).not.toHaveBeenCalled();
    flushSync(() => matches[0]!.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledWith("second");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    search.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
