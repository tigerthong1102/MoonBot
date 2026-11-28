// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { api } from "@/state/api";
import { ZaloModelAnalysis } from "./ZaloModelAnalysis";
vi.mock("@/state/api", async load => ({ ...await load<object>(), api: vi.fn() }));

it("separates a text-free provider preview from explicit submission of a chosen line", async () => {
  vi.mocked(api).mockResolvedValueOnce({ token: "fixture-token", provider: "Loopback", model: "fixture-small" })
    .mockResolvedValueOnce({ findings: [{ kind: "invoice", line: 5, quote: "xuất hóa đơn" }] });
  const panel = document.createElement("div"), root = createRoot(panel);
  const button = (text: string) => [...panel.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
  try {
    await act(async () => root.render(createElement(ZaloModelAnalysis, {
      bot: { id: "reader", threadId: "private" } as Bot, source: "Private source name",
      rows: [{ line: 2, text: "private unrelated line" }, { line: 5, text: "Nhờ xuất hóa đơn" }],
    })));
    expect(api).not.toHaveBeenCalled();
    const disclosure = button("Analyze selected lines");
    const target = panel.querySelector<HTMLElement>(`[id="${disclosure.getAttribute("aria-controls")}"]`)!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(target.hidden).toBe(true);
    expect(target.childNodes).toHaveLength(0);
    await act(async () => disclosure.click());
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(target.hidden).toBe(false);
    expect(vi.mocked(api).mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(button("Send selected lines").disabled).toBe(true);
    expect(panel.textContent).toContain("Loopback");
    await act(async () => (panel.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement).click());
    await act(async () => button("Send selected lines").click());
    const posted = JSON.parse(String(vi.mocked(api).mock.calls[1]?.[1]?.body));
    expect(posted).toEqual({ token: "fixture-token", consent: true, recipe: "accounting", conversation: "unspecified",
      lines: [{ line: 5, text: "Nhờ xuất hóa đơn" }] });
    expect(panel.querySelector("q")?.textContent).toBe("xuất hóa đơn");
    await act(async () => (panel.querySelectorAll('input[type=checkbox]')[0] as HTMLInputElement).click());
    expect(panel.querySelector("q")).toBeNull();
    expect(button("Review the model again")).toBeTruthy();
    await act(async () => disclosure.click());
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(target.hidden).toBe(true);
    expect(target.childNodes).toHaveLength(0);
    expect(panel.textContent).not.toContain("private unrelated line");
    expect(api).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); }
});
