// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { shareableReportOrigin } from "@/lib/report-link";
import { usePageShare } from "./PageTools";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("@/state/store", async original => ({ ...await original<typeof import("@/state/store")>(), api: lookup }));

it.each(["https://127.0.0.2", "http://[::1]", "http://dev.localhost", "file:///tmp/app", ""])("keeps %s private to this device", origin => {
  expect(shareableReportOrigin(origin)).toBe("");
});

it("retains a local preview while waiting for an origin that recipients can open", async () => {
  let resolve!: (settings: { publicUrl: string }) => void;
  lookup.mockReturnValue(new Promise(done => { resolve = done; }));
  const preview = new URL("/?report=room%2Fpage", window.location.href).href;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Report() {
    const { previewUrl, reportUrl } = usePageShare("room", "page", undefined, true);
    return createElement("a", { href: previewUrl, "data-copy": reportUrl });
  }
  try {
    await act(async () => root.render(createElement(Report)));
    const link = host.querySelector("a")!;
    expect(link.href).toBe(preview);
    expect(link.dataset.copy).toBe("");
    await act(async () => resolve({ publicUrl: "https://org.example.test" }));
    expect(link.dataset.copy).toBe("https://org.example.test/?report=room%2Fpage");
    expect(shareableReportOrigin("http://192.168.1.10:8080")).toBe("http://192.168.1.10:8080");
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
