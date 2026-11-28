// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "@/state/api";
import { ZaloImportSection } from "./ZaloImportSection";
vi.mock("@/state/api", async load => ({ ...await load<object>(), api: vi.fn() }));

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
    await act(async () => root.render(createElement(ZaloImportSection, { twinEnabled: true })));
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
    expect(api).not.toHaveBeenCalled();
    await act(async () => button("Review a Zalo excerpt").click());
    await act(async () => button("Review a Zalo excerpt").click());
    expect(panel.querySelector("textarea")?.value).toBe("");
    expect(panel.querySelector("input")?.value).toBe("");
    expect(panel.textContent).not.toContain("Nhóm tổng hợp");
  } finally {
    await act(async () => root.unmount());
  }
});
