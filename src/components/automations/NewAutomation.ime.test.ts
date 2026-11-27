// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: fixture.api,
    useStore: () => ({ state: { ...original.initialState, bots: [bot], selectedId: bot.id, instances: [{ instanceId: "claude", driverKind: "claudeAgent" }] }, dispatch: fixture.dispatch }),
  };
});

import { NewAutomation } from "./NewAutomation";

const bot: Bot = {
  id: "ime-bot", threadId: "ime-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [], section: "",
  modelSelection: { instanceId: "claude", model: "fake" },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function open() {
  const onClose = vi.fn();
  flushSync(() => root.render(createElement(NewAutomation, { onClose, onSetUpYourself: vi.fn() })));
  return { onClose, box: document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')! };
}

function type(box: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  flushSync(() => {
    setter.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(box: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
  flushSync(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })));
}

describe("New automation box with an input method", () => {
  it.each([
    { name: "composition", init: { isComposing: true } },
    { name: "IME key code", init: { keyCode: 229 } },
  ])("does not send a half-typed request on the Enter that belongs to the $name", ({ init }) => {
    const { onClose, box } = open();
    type(box, "每天早上 jiudian");
    press(box, init);
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends on the Enter after the text is committed", () => {
    const { onClose, box } = open();
    type(box, "每天早上九点总结邮件");
    press(box);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "send", botId: bot.id, text: "每天早上九点总结邮件", threadId: bot.threadId });
    expect(onClose).toHaveBeenCalledOnce();
  });
});


it("opens a business template, previews only demo records and installs it paused", async () => {
  const { onClose } = open();
  const click = (label: string) => flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click());
  click("Business templates");
  click("Run with demo records");
  expect(host.querySelector("[aria-live]")?.textContent).toContain("DEMO-001");
  expect(fixture.api).not.toHaveBeenCalled();
  fixture.api.mockResolvedValueOnce({ routine: { id: "r" } });
  flushSync(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const [url, options] = fixture.api.mock.calls[0]!;
  expect(url).toBe("/api/routines");
  expect(JSON.parse(options.body)).toMatchObject({ enabled: false, access: "read-gmail", botId: bot.id, resultsThreadId: null });
});
