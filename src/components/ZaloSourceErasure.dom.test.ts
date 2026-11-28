// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { localDayInterval, ZaloSourceErasure } from "./ZaloSourceErasure";

afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });
it("validates actual local dates and clips today's end to the current instant", () => {
  const now = +new Date(2026, 10, 28, 16);
  expect(localDayInterval("2026-02-30", "2026-03-01", now)).toBeUndefined();
  expect(localDayInterval("2026-11-29", "2026-11-29", now)).toBeUndefined();
  expect(localDayInterval("2026-11-02", "2026-11-01", now)).toBeUndefined();
  expect(localDayInterval("2026-11-27", "2026-11-28", now)).toEqual({ start: +new Date(2026, 10, 27), end: now });
  expect(localDayInterval("2026-11-01", "2026-11-01", now)).toEqual({ start: +new Date(2026, 10, 1), end: +new Date(2026, 10, 2) - 1 });
});
it("requires an explicit fresh preview for edited dates and displays committed readback", async () => {
  setLocale("en");
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    calls.push(body);
    return Response.json(body.action === "preview" ? { count: 2, confirmation: "token" } : { erased: 2, coverage: { count: 0 } });
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), done = vi.fn();
  flushSync(() => root.render(createElement(ZaloSourceErasure, { revision: "grant", onErased: done })));
  const inputs = host.querySelectorAll("input"), find = (name: string) => Array.from(host.querySelectorAll("button")).find(x => x.textContent === name);
  function date(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  try {
    const preview = find("Count matching messages")!;
    expect(preview.disabled).toBe(true);
    date(inputs[0]!, "2024-09-01"); date(inputs[1]!, "2024-09-10");
    await vi.waitFor(() => expect(preview.disabled).toBe(false));
    preview.click();
    const confirm = "Permanently erase these messages";
    await vi.waitFor(() => expect(find(confirm)).toBeDefined());
    date(inputs[1]!, "2024-09-02");
    await vi.waitFor(() => expect(find(confirm)).toBeUndefined());
    expect(calls).toHaveLength(1);
    preview.click();
    await vi.waitFor(() => expect(find(confirm)).toBeDefined());
    find(confirm)!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Messages erased: 2."));
    expect(done).toHaveBeenCalledWith({ count: 0 });
    expect(calls[2]).toEqual({ ...calls[1], action: "erase", confirmation: "token" });
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
