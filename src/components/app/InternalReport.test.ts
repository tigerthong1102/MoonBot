// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { botHtmlDocument } from "../../../shared/app-frame/document";
import InternalReport from "./InternalReport";
import { fetchAppDocument } from "./app-api";

vi.mock("./app-api", () => ({ fetchAppDocument: vi.fn() }));

it("initializes an older direct-report frame read-only and removes its bridge on loss of report access", async () => {
  const doc = botHtmlDocument({ messageId: "m", rev: 0, html: "<p>Report</p>" });
  vi.mocked(fetchAppDocument).mockResolvedValue(doc);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const intervals = vi.spyOn(window, "setInterval");
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  try {
    await act(async () => root.render(createElement(InternalReport, { threadId: "t", messageId: "m" })));
    expect(fetchAppDocument).toHaveBeenLastCalledWith("t", "m", expect.any(AbortSignal), undefined, { report: true, background: false });
    const poll = intervals.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
    expect(typeof poll).toBe("function");
    await act(async () => { if (typeof poll === "function") poll(); });
    expect(fetchAppDocument).toHaveBeenLastCalledWith("t", "m", expect.any(AbortSignal), undefined, { report: true, background: true });
    const frame = container.querySelector("iframe")!;
    expect(document.head.querySelector("meta[data-report-frame-policy]")?.getAttribute("content")).toBe("frame-src about:");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(container.querySelector("header h1")?.textContent).toContain("StartupBot");
    const view = frame.contentWindow!;
    const post = vi.spyOn(view, "postMessage").mockImplementation(() => {});
    const send = (id: number, method: string, params: object = {}) => window.dispatchEvent(new MessageEvent("message", {
      origin: "null", source: view as unknown as MessageEventSource, data: { jsonrpc: "2.0", id, method, params },
    }));
    send(1, "ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "report", version: "1" }, appCapabilities: {} });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ id: 1, result: expect.objectContaining({
      hostCapabilities: expect.objectContaining({ openLinks: {} }),
    }) }), "*");
    const init = post.mock.calls[0]![0] as { result: { hostCapabilities: object } };
    expect(init.result.hostCapabilities).not.toHaveProperty("message");
    expect(init.result.hostCapabilities).not.toHaveProperty("updateModelContext");
    window.dispatchEvent(new MessageEvent("message", { origin: "null", source: view as unknown as MessageEventSource,
      data: { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} } }));
    for (const [i, method] of ["ui/message", "ui/update-model-context", "tools/call", "resources/read"].entries()) {
      send(i + 2, method);
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ id: i + 2, error: expect.any(Object) }), "*");
    }
    const external = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { userActivation: { isActive: true } }));
    frame.focus();
    await act(async () => { send(10, "ui/open-link", { url: "https://example.test/ledger" }); });
    const offered = container.querySelector("a");
    expect(offered?.getAttribute("href")).toBe("https://example.test/ledger");
    expect(external).not.toHaveBeenCalled();
    vi.mocked(fetchAppDocument).mockRejectedValueOnce(new Error("No access"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(frame.isConnected).toBe(false);
    expect(container.querySelector("a")).toBeNull();
    expect(external).not.toHaveBeenCalled();
    post.mockClear();
    send(6, "ui/initialize");
    expect(post).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
