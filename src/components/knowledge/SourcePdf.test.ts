// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SourcePdf } from "./SourcePdf";
import { openSourcePdf } from "./pdf-text";
import { setLocale } from "@/lib/i18n";

vi.mock("./pdf-text", () => ({ openSourcePdf: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
const file = new File(["fixture"], "policy.pdf", { type: "application/pdf" });

it("opens the cited page on desktop without a popup and releases the render and PDF on close", async () => {
  setLocale("en");
  const existing = window.ogb;
  Object.defineProperty(window, "ogb", { configurable: true, value: { platform: "win32" } });
  const makeUrl = vi.spyOn(URL, "createObjectURL");
  const popup = vi.spyOn(window, "open");
  const cancel = vi.fn(), destroy = vi.fn().mockResolvedValue(undefined);
  const getPage = vi.fn().mockResolvedValue({ cleanup: vi.fn(), getViewport: () => ({ width: 450, height: 600 }),
    render: () => ({ promise: Promise.resolve(), cancel }) });
  vi.mocked(openSourcePdf).mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage }), destroy } as unknown as ReturnType<typeof openSourcePdf>);
  const host = document.createElement("div"), root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll("button")].find(el => el.textContent === text)!;
  try {
    await act(async () => root.render(createElement(SourcePdf, { file, path: file.name, page: 2 })));
    await act(async () => button("Open original PDF at this page").click());
    expect(getPage).toHaveBeenLastCalledWith(2);
    expect(host.querySelector("canvas")?.getAttribute("aria-label")).toBe("policy.pdf · 2 / 3");
    await act(async () => button("Next").click());
    expect(getPage).toHaveBeenLastCalledWith(3);
    expect(button("Next").disabled).toBe(true);
    await act(async () => button("Close").click());
    expect(host.querySelector("canvas")).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalled();
    expect(popup).not.toHaveBeenCalled();
    expect(makeUrl).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); Object.defineProperty(window, "ogb", { configurable: true, value: existing }); }
});

it("preserves the browser's local PDF link and revokes it when the citation closes", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf-fixture");
  const release = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SourcePdf, { file, path: file.name, page: 2 })));
    expect(host.querySelector("a")?.getAttribute("href")).toBe("blob:pdf-fixture#page=2");
    expect(openSourcePdf).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
  expect(release).toHaveBeenCalledWith("blob:pdf-fixture");
});
