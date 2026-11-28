// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "@/state/api";
import { ZaloPeriodReports } from "./ZaloPeriodReports";
vi.mock("@/state/api", async load => ({ ...await load<object>(), api: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = { accountId: "bot-fixture", conversationId: "chat-fixture", senderId: "sender-fixture" };
const schedule = { cadence: "daily", hour: 17, minute: 0, timeZone: "Asia/Ho_Chi_Minh" };

it("shows local receipts in Today and clears the previous grant after permission changes", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  vi.mocked(api).mockResolvedValueOnce({ view: { revision: "current", source, schedule, next: 10_000, periods: [{ start: 100, end: 1000, timeZone: "UTC", count: 4, examined: 4, urgent: 1, gaps: 2 }] } }).mockResolvedValueOnce({ view: null });
  try {
    await act(async () => root.render(createElement(ZaloPeriodReports)));
    expect(host.textContent).toContain("4 incoming messages");
    expect(host.textContent).toContain("History may be incomplete");
    expect(host.querySelector("form")).toBeNull();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toBe("");
  } finally { act(() => root.unmount()); vi.mocked(api).mockReset(); }
});

it("saves the owner's hourly local schedule with its current revision and supports withdrawal", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const value = { revision: "first", source, schedule, next: 10_000, periods: [] };
  vi.mocked(api).mockResolvedValue({ view: value });
  try {
    await act(async () => root.render(createElement(ZaloPeriodReports, { manage: true })));
    await act(async () => {
      const select = host.querySelector("select")!;
      select.value = "hourly"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const posts = () => vi.mocked(api).mock.calls.flatMap(([url, options]) => options?.method === "POST" ? [[url, JSON.parse(String(options.body))]] : []);
    expect(posts()).toEqual([["/api/zalo-official/reports", { revision: "first", schedule: { ...schedule, cadence: "hourly" } }]]);
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Stop and remove"))!.click());
    expect(posts().at(-1)).toEqual(["/api/zalo-official/reports", { revision: "first", schedule: null }]);
  } finally { act(() => root.unmount()); vi.mocked(api).mockReset(); }
});
