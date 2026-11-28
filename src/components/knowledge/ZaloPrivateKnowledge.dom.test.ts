// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ZaloPrivateKnowledge } from "./ZaloPrivateKnowledge";

afterEach(() => vi.unstubAllGlobals());
it("reads on demand, confirms a reference without posting its text and erases the visible quotation after revocation", async () => {
  const calls: string[] = [];
  const writes: unknown[] = [];
  const entry = {
    sourceId: "msg",
    grantId: "grant",
    revision: "first",
    quote: "Chính sách mẫu 17 ngày",
    conversationId: "chat",
    senderId: "sender",
    timestamp: Date.now(),
    expires: Date.now() + 30000,
    saved: false,
  };
  let items = [entry];
  vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
    calls.push(path);
    expect(options).toMatchObject({ mode: "same-origin", redirect: "error", cache: "no-store" });
    if (path.includes("?capability")) return Response.json({ enabled: true });
    if (options.body) {
      writes.push(JSON.parse(String(options.body)));
      items = [{ ...entry, saved: true, revision: "next" }];
    }
    return Response.json({ items });
  });
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const button = (label: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === label);
  try {
    function Shelf() {
      const [open, setOpen] = useState(false);
      return createElement(ZaloPrivateKnowledge, {query: "chinh sach", open, setOpen});
    }
    flushSync(() => root.render(createElement(Shelf)));
    await vi.waitFor(() => expect(button("Private Zalo references")).toBeDefined());
    expect(calls).toHaveLength(1);
    expect(el.textContent).not.toContain(entry.quote);
    button("Private Zalo references")!.click();
    await vi.waitFor(() => expect(el.textContent).toContain(entry.quote));
    button("Approve private bookmark")!.click();
    await vi.waitFor(() => expect(el.textContent).toContain("Saved in private knowledge"));
    expect(writes).toEqual([{ sourceId: "msg", grantId: "grant", revision: "first", save: true, reviewed: true }]);
    items = [];
    window.dispatchEvent(new Event("startupbot-zalo-scope-changed"));
    await vi.waitFor(() => expect(el.textContent).not.toContain(entry.quote));
    expect(writes).toHaveLength(1);
  } finally {
    flushSync(() => root.unmount());
    el.remove();
  }
});
