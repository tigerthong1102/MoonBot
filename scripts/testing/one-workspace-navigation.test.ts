import { describe, expect, it } from "vitest";

import { TabWindow } from "./one-workspace-fixture.ts";

function windowFor(answer: Record<string, unknown>) {
  const listeners = new Map<string, Set<(params: any, session?: string) => void>>();
  const cdp = {
    request: async () => answer,
    on(method: string, listener: (params: any, session?: string) => void) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method)!.add(listener);
      return () => listeners.get(method)!.delete(listener);
    },
  };
  return {
    window: new TabWindow(cdp as never, "target", "session"),
    emit(method: string, params: unknown, session = "session") { for (const listener of listeners.get(method) ?? []) listener(params, session); },
    lifecycleListeners: () => listeners.get("Page.lifecycleEvent")?.size ?? 0,
  };
}

describe("the fixture window's loadURL contract", () => {
  it("waits for the matching document to finish, ignoring other loaders and windows", async () => {
    const w = windowFor({ loaderId: "document" });
    let finished = false;
    const navigation = w.window.loadURL("http://fixture.test/").then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    w.emit("Page.lifecycleEvent", { name: "load", loaderId: "document" }, "other-session");
    w.emit("Page.lifecycleEvent", { name: "load", loaderId: "other-document" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    w.emit("Page.lifecycleEvent", { name: "load", loaderId: "document" });
    await navigation;
    expect(finished).toBe(true);
    expect(w.lifecycleListeners()).toBe(0);
  });

  it("finishes same-document navigation without waiting for a new loader", async () => {
    const w = windowFor({});
    await w.window.loadURL("http://fixture.test/#same-document");
    expect(w.lifecycleListeners()).toBe(0);
  });

  it("rejects failed navigation and removes its document listener", async () => {
    const w = windowFor({ errorText: "net::ERR_CONNECTION_REFUSED" });
    await expect(w.window.loadURL("http://fixture.test/")).rejects.toThrow("ERR_CONNECTION_REFUSED");
    expect(w.lifecycleListeners()).toBe(0);
  });

  it("rejects a failed document after navigation starts", async () => {
    const w = windowFor({ loaderId: "document" });
    const outcome = w.window.loadURL("http://fixture.test/").then(() => null, (error: Error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    w.emit("Network.requestWillBeSent", { type: "Document", requestId: "request", loaderId: "document" });
    w.emit("Network.loadingFailed", { type: "Document", requestId: "request", errorText: "net::ERR_ABORTED", canceled: true });
    expect((await outcome)?.message).toContain("ERR_ABORTED");
    expect(w.lifecycleListeners()).toBe(0);
  });

  it("accepts a document load before navigate acknowledges its loader", async () => {
    const w = windowFor({ loaderId: "document" });
    const navigation = w.window.loadURL("http://fixture.test/");
    w.emit("Page.lifecycleEvent", { name: "load", loaderId: "document" });
    await navigation;
    expect(w.lifecycleListeners()).toBe(0);
  });

  it("rejects and removes listeners when the fixture connection closes", async () => {
    const w = windowFor({ loaderId: "document" });
    const outcome = w.window.loadURL("http://fixture.test/").then(() => null, (error: Error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    w.emit("Fixture.closed", {});
    expect((await outcome)?.message).toBe("Fixture Chrome closed");
    expect(w.lifecycleListeners()).toBe(0);
  });
});
