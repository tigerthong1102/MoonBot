// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ZaloApprovedReply } from "./ZaloApprovedReply";

afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });
const source = { grantId: "grant", accountId: "owner-bot", senderId: "sender-id", conversationId: "private-id", sourceId: "source-id",
  sourceText: "nội dung nguồn thử riêng", sourceTime: Date.now(), sourceExpires: Date.now() + 60_000, accountHeld: false };

it.each(["acknowledged", "disconnected", "erased"])("binds the approval to the source and handles %s", async outcome => {
  setLocale("vi");
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    expect(path).toBe("/api/zalo-official/reply");
    expect(init).toMatchObject({ mode: "same-origin", cache: "no-store", redirect: "error" });
    if (!init.body) return Response.json({ source });
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    if (body.action === "preview") return Response.json({ source, text: body.text, digest: "sha", actionId: "action-id", expires: Date.now() + 30_000 });
    if (outcome === "disconnected") throw Error("fixture disconnect");
    return Response.json({ status: "acknowledged", receiptId: "receipt-id" });
  });
  const host = document.createElement("div");
  document.body.append(host); const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ZaloApprovedReply)));
    expect(host.textContent).not.toContain("nội dung nguồn thử riêng");
    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("nội dung nguồn thử riêng"));
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Nội dung cuối chính xác.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(false));
    host.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    await vi.waitFor(() => expect(host.querySelector("pre")?.textContent).toBe("Nội dung cuối chính xác."));
    for (const label of ["owner-bot", "sender-id", "private-id", "action-id", "không dùng AI"]) expect(host.textContent).toContain(label);
    expect(bodies).toHaveLength(1);
    const token = host.querySelector<HTMLInputElement>("input[type=password]")!;
    token.value = "927:fixture";
    if (outcome === "erased") {
      flushSync(() => window.dispatchEvent(new Event("startupbot-zalo-scope-changed")));
      expect(token.value).toBe("");
      expect(host.querySelector("form, blockquote, pre, input[type=password]")).toBeNull();
      expect(host.textContent).not.toContain(source.sourceText);
      expect(bodies).toHaveLength(1);
      return;
    }
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(token.value).toBe("");
    await vi.waitFor(() => expect(host.textContent).toContain(outcome === "disconnected" ? "Chưa rõ tin đã tới chưa" : "receipt-id"));
    expect(host.querySelector("form")).toBeNull();
    expect(bodies[1]).toMatchObject({ action: "send", actionId: "action-id", digest: "sha", text: "Nội dung cuối chính xác.",
      sourceId: "source-id", approvedByOwner: true });
    expect(bodies[1]).not.toHaveProperty("chat_id");
    expect(bodies).toHaveLength(2);
  } finally { flushSync(() => root.unmount()); host.remove(); }
});

it("discards a late source read when the owner erases the source", async () => {
  const reply = Promise.withResolvers<Response>();
  const fetchSource = vi.fn(() => reply.promise);
  vi.stubGlobal("fetch", fetchSource);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ZaloApprovedReply)));
    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(fetchSource).toHaveBeenCalledOnce());
    flushSync(() => window.dispatchEvent(new Event("startupbot-zalo-scope-changed")));
    await act(async () => { reply.resolve(Response.json({ source })); });
    expect(host.querySelector("form, blockquote")).toBeNull();
    expect(host.querySelector("button")!.disabled).toBe(false);
  } finally { flushSync(() => root.unmount()); }
});
