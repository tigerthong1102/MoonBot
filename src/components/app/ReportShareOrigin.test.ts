// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { shareableReportOrigin } from "@/lib/report-link";
import { usePageShare } from "./PageTools";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("@/state/store", async original => ({ ...await original<typeof import("@/state/store")>(), api: lookup }));

it.each(["https://127.0.0.2", "https://[::ffff:127.0.0.1]", "http://[::ffff:0.0.0.0]", "http://[::1]", "http://dev.localhost", "file:///tmp/app", ""])("keeps %s private to this device", origin => {
  expect(shareableReportOrigin(origin)).toBe("");
});

it.each(["http://localhost:4321", "http://192.168.1.25"])("retains the preview at %s while looking up the configured sharing origin", async origin => {
  let resolve!: (settings: { configured: string; detected: string }) => void;
  lookup.mockReturnValue(new Promise(done => { resolve = done; }));
  const location = new URL(origin);
  vi.spyOn(window, "location", "get").mockReturnValue(location as unknown as Location);
  const preview = new URL("/?report=room%2Fpage", window.location.href).href;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Report() {
    const { previewUrl, reportUrl, findingReportOrigin } = usePageShare("room", "page", undefined, true);
    return createElement("a", { href: previewUrl, "data-copy": reportUrl, "data-pending": findingReportOrigin });
  }
  try {
    await act(async () => root.render(createElement(Report)));
    const link = host.querySelector("a")!;
    expect(link.href).toBe(preview);
    expect(lookup).toHaveBeenLastCalledWith("/api/threads/room/messages/page/app?shareOrigin=1", expect.anything());
    expect(link.dataset.copy).toBe("");
    expect(link.dataset.pending).toBe("true");
    await act(async () => resolve({ configured: "https://org.example.test", detected: "http://192.168.1.10:8080" }));
    expect(link.dataset.pending).toBe("false");
    expect(link.dataset.copy).toBe("https://org.example.test/?report=room%2Fpage");
    expect(shareableReportOrigin("http://192.168.1.10:8080")).toBe("http://192.168.1.10:8080");
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

it.each([
  ["https://proxy.example.test", "http://192.168.1.10:8080", "https://proxy.example.test"],
  ["http://192.168.1.25:8080", "http://192.168.1.10:8080", "http://192.168.1.25:8080"],
  ["http://localhost:4321", "http://192.168.1.10:8080", "http://192.168.1.10:8080"],
  ["http://localhost:4321", null, ""],
])("chooses a share address for %s with detected origin %s", async (browser, detected, expected) => {
  lookup.mockResolvedValue({ configured: null, detected });
  vi.spyOn(window, "location", "get").mockReturnValue(new URL(browser) as unknown as Location);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Report() {
    const { previewUrl, reportUrl, findingReportOrigin, reportOriginFailed } = usePageShare("room", "page", undefined, true);
    return createElement("a", { href: previewUrl, "data-copy": reportUrl, "data-pending": findingReportOrigin, "data-failed": reportOriginFailed });
  }
  try {
    await act(async () => root.render(createElement(Report)));
    const link = host.querySelector("a")!;
    expect(link.href).toBe(browser + "/?report=room%2Fpage");
    expect(link.dataset.pending).toBe("false");
    expect(link.dataset.failed).toBe("false");
    expect(link.dataset.copy).toBe(expected && expected + "/?report=room%2Fpage");
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
