// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { cloudAsleep, resetCloudPowerForTests } from "@/lib/cloud-power";
import { botHtmlDocument } from "../../../shared/app-frame/document";
import InternalReport from "./InternalReport";

it("keeps the selected section asleep between polls and removes it when access is revoked", async () => {
  const report = botHtmlDocument({ messageId: "root", rev: 1, html: "<p>Root</p>" });
  const section = botHtmlDocument({ messageId: "detail", rev: 1, html: "<p>Detail</p>" });
  const rootReport = { ...report, sections: [{ threadId: "other", messageId: "detail", title: "Detail" }] };
  let asleep = false;
  let revoked = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/messages/detail/") && revoked) return Response.json({}, { status: 404 });
    if (url.includes("/messages/detail/") && asleep && new Headers(init?.headers).get("x-omb-background")) {
      return Response.json({ error: "asleep" }, { status: 503, headers: { "x-omb-cloud-power": "asleep" } });
    }
    return Response.json(url.includes("/messages/detail/") ? section : rootReport);
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const ticks = vi.spyOn(window, "setInterval");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(InternalReport, { threadId: "t", messageId: "root" })));
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "other/detail"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const frame = host.querySelector("iframe")!;
    expect(frame.srcdoc).toContain("<p>Detail</p>");
    const tick = ticks.mock.calls.findLast(([, ms]) => ms === 30_000)?.[0];
    if (typeof tick !== "function") throw new Error("Missing report poll");
    asleep = true;
    fetcher.mockClear();
    await act(async () => { tick(); });
    expect(cloudAsleep()).toBe(true);
    expect(host.querySelector("select")?.value).toBe("other/detail");
    expect(host.querySelector("iframe")).toBe(frame);
    expect(fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).has("x-omb-background"))).toBe(true);
    const sent = fetcher.mock.calls.length;
    await act(async () => { tick(); });
    expect(fetcher).toHaveBeenCalledTimes(sent);
    asleep = false;
    revoked = true;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(frame.isConnected).toBe(false);
  } finally {
    act(() => root.unmount());
    host.remove();
    resetCloudPowerForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
