// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

import { BotPickerList } from "./BotPickerList";

const clipboard = vi.hoisted(() => vi.fn(async (_text: string) => "copied" as const));
vi.mock("@/lib/clipboard-write", () => ({ copyText: clipboard }));

it("finds a bot by its distinct username and selects its ID", async () => {
  const username = `bot_k${"b".repeat(64)}`;
  const bots = [{ id: "first", name: "Scout", groupUsername: `bot_k${"a".repeat(64)}` }, { id: "second", name: "Scout", groupUsername: username }] as Bot[];
  const toggle = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(BotPickerList, { bots, allBots: bots, picked: new Set<string>(), onToggle: toggle, emptyHint: "Empty" })));
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => { setter.call(search, `@${username}`); search.dispatchEvent(new Event("input", { bubbles: true })); });
    const matches = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(matches).toHaveLength(1);
    flushSync(() => host.querySelector<HTMLButtonElement>(`button[aria-label$="@${username}"]:not([role])`)!.click());
    await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith(`@${username}`));
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

it("does not display or copy unregistered or duplicate usernames", () => {
  const duplicate = `bot_k${"a".repeat(64)}`;
  const bots = [{ id: "one", name: "One", groupUsername: duplicate }, { id: "two", name: "Two", groupUsername: duplicate }, { id: "legacy", name: "Legacy" }] as Bot[];
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    flushSync(() => root.render(createElement(BotPickerList, { bots, allBots: bots, picked: new Set<string>(), onToggle: () => {}, emptyHint: "Empty" })));
    expect([...host.querySelectorAll('[role="checkbox"]')].map(element => element.getAttribute("aria-label"))).toEqual(["One", "Two", "Legacy"]);
    expect(host.querySelectorAll('button:not([role="checkbox"])')).toHaveLength(0);
    expect(host.textContent).not.toContain("@bot_");
  } finally { flushSync(() => root.unmount()); host.remove(); }
});

it("does not expose a username duplicated by a hidden bot outside the picker", () => {
  const username = `bot_k${"c".repeat(64)}`;
  const visible = { id: "visible", name: "Visible", groupUsername: username } as Bot;
  const hidden = { id: "hidden", name: "Private fixture", groupUsername: username, hidden: true } as Bot;
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    flushSync(() => root.render(createElement(BotPickerList, { bots: [visible], allBots: [visible, hidden], picked: new Set<string>(), onToggle: () => {}, emptyHint: "Empty" })));
    expect(host.querySelector('[role="checkbox"]')?.getAttribute("aria-label")).toBe("Visible");
    expect(host.querySelectorAll('button:not([role="checkbox"])')).toHaveLength(0);
    expect(host.textContent).not.toContain("Private fixture");
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
