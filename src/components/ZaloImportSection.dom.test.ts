// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { api } from "@/state/api";
import { ZaloImportSection } from "./ZaloImportSection";
vi.mock("@/state/api", async load => ({ ...await load<object>(), api: vi.fn() }));

vi.mock("./RoutineCalendarPage", () => ({ EventEditor: () => createElement("dialog", { "aria-label": "routine editor" }) }));
vi.mock("./knowledge/BrainDialog", () => ({ default: () => createElement("dialog", { "aria-label": "knowledge search" }) }));

it("keeps the excerpt local, preserves source lines and clears the review on closing", async () => {
  const panel = document.createElement("div");
  const root = createRoot(panel);
  const button = (label: string) => Array.from(panel.querySelectorAll("button")).find(b => b.textContent?.includes(label))!;
  function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  try {
    await act(async () => root.render(createElement(ZaloImportSection, { twinEnabled: true, bot: { id: "bot-fixture", threadId: "thread-fixture" } as Bot })));
    await act(async () => button("Review a Zalo excerpt").click());
    await act(async () => {
      fill(panel.querySelector("input")!, "Nhóm tổng hợp");
      fill(panel.querySelector("textarea")!, "\nXin báo giá gấp\n<script>run()</script>");
    });
    await act(async () => panel.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(panel.textContent).toContain("2 nonempty lines");
    expect(panel.textContent).toContain("Line 2");
    expect(panel.textContent).toContain("Possible quote request");
    expect(panel.textContent).toContain("<script>run()</script>");
    expect(panel.querySelector("script")).toBeNull();
    await act(async () => button("Prepare a reminder").click());
    await act(async () => button("Find related pages").click());
    for (const label of ["routine editor", "knowledge search"]) {
      const selector = 'dialog[aria-label="' + label + '"]';
      expect(document.body.querySelector(selector)).toBeTruthy();
      expect(panel.querySelector(selector)).toBeNull();
    }
    expect(api).not.toHaveBeenCalled();
    const preview = panel.querySelector<HTMLButtonElement>("li button[aria-expanded]")!;
    const target = panel.querySelector<HTMLElement>(`[id="${preview.getAttribute("aria-controls")}"]`)!;
    expect(preview.getAttribute("aria-expanded")).toBe("false");
    expect(target.hidden).toBe(true);
    expect(target.childNodes).toHaveLength(0);
    vi.mocked(api).mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => preview.click());
    expect(preview.getAttribute("aria-expanded")).toBe("true");
    expect(target.hidden).toBe(false);
    expect(target.querySelector('[role="status"]')).not.toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
    const [, request] = vi.mocked(api).mock.calls[0]!;
    expect(request?.body).toBeUndefined();
    await act(async () => preview.click());
    expect(preview.getAttribute("aria-expanded")).toBe("false");
    expect(target.hidden).toBe(true);
    expect(target.childNodes).toHaveLength(0);
    expect(request?.signal?.aborted).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => button("Review a Zalo excerpt").click());
    await act(async () => button("Review a Zalo excerpt").click());
    expect(panel.querySelector("textarea")?.value).toBe("");
    expect(panel.querySelector("input")?.value).toBe("");
    expect(panel.textContent).not.toContain("Nhóm tổng hợp");
  } finally {
    await act(async () => root.unmount());
  }
});
it("filters a second page without renumbering rows or handing clipboard text to a provider", async () => {
  const panel = document.createElement("div"), root = createRoot(panel);
  const button = (text: string) => [...panel.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
  const change = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    vi.mocked(api).mockClear();
    await act(async () => root.render(createElement(ZaloImportSection, { twinEnabled: false })));
    await act(async () => button("Review a Zalo excerpt").click());
    const texts = Array.from({ length: 21 }, (_, i) => "Dòng mẫu " + i);
    texts.push("Cần bổ sung chứng từ trước 15h ngày mai", texts[1]);
    await act(async () => {
      change(panel.querySelector("input")!, "Nguồn thử");
      change(panel.querySelector("textarea")!, texts.join("\n"));
    });
    await act(async () => panel.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => button("Next").click());
    const choose = async (filter: string) => {
      await act(async () => {
        const select = panel.querySelector("select")!;
        select.value = filter;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await choose("documents");
    expect(panel.querySelectorAll("li")).toHaveLength(1);
    expect(panel.querySelector("li")?.textContent).toContain("Line 22");
    expect(panel.querySelector("li")?.textContent).toContain("trước 15h ngày mai");
    await choose("duplicate");
    expect(panel.querySelector("li")?.textContent).toContain("Same text as line 2");
    await choose("property");
    expect(panel.querySelectorAll("li")).toHaveLength(0);
    expect(panel.textContent).toContain("No source lines match");
    expect(api).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
