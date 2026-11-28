// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AiTwinProfile } from "../../shared/ai-twin";
import { AiTwinZaloOwnerStyle } from "./AiTwinZaloOwnerStyle";

afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

it("opens a blank editor, requires an authorship attestation, clears raw text and approves only selected traits in Vietnamese", async () => {
  setLocale("vi");
  const twin: AiTwinProfile = { id: "twin", name: "fixture", revision: 1, style: "", paused: false, createdAt: 1, updatedAt: 1 };
  const writes: Record<string, unknown>[] = [];
  let approved = false;
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    expect(path).toBe("/api/ai-twin/zalo-owner-style");
    expect(init).toMatchObject({ mode: "same-origin", redirect: "error", cache: "no-store" });
    if (!init.body) return Response.json({ id: twin.id, revision: twin.revision, paused: false,
      approved: approved ? { provenance: "owner-desktop-editor", traits: ["em"], approvedAt: 1 } : null });
    const input = JSON.parse(String(init.body)); writes.push(input);
    if (input.action === "propose") return Response.json({ proposalId: "nonce", expires: Date.now() + 10000, traits: ["brief", "em"] });
    approved = input.action === "approve"; return Response.json({ ok: true });
  });
  const host = document.createElement("div");
  document.body.append(host); const root = createRoot(host);
  const button = (name: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent === name)!;
  try {
    flushSync(() => root.render(createElement(AiTwinZaloOwnerStyle, { twin, refresh: () => {} })));
    button("Phong cách Zalo từ mẫu tự viết").click();
    const field = await vi.waitFor(() => { const n = host.querySelector("textarea"); expect(n).not.toBeNull(); return n!; });
    expect(field.value).toBe("");
    expect(button("Đề xuất đặc điểm cách viết").disabled).toBe(true);
    expect(field.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }))).toBe(false);
    field.value = "Em đang viết một ví dụ mới tại đây.";
    host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
    await vi.waitFor(() => expect(button("Đề xuất đặc điểm cách viết").disabled).toBe(false));
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(field.value).toBe("");
    await vi.waitFor(() => expect(host.textContent).toContain("Chọn các đặc điểm"));
    expect(host.textContent).not.toContain("một ví dụ mới");
    host.querySelector<HTMLElement>("fieldset input")!.click();
    button("Lưu các đặc điểm đã chọn").click();
    await vi.waitFor(() => expect(host.textContent).toContain("Em đã nhận yêu cầu."));
    expect(writes[0]).toMatchObject({ action: "propose", provenance: "owner-desktop-editor", authorConsent: true });
    expect(writes[1]).toMatchObject({ action: "approve", approveConsent: true, traits: ["em"], proposalId: "nonce" });
    expect(writes[1]).not.toHaveProperty("sample");
    button("Xóa phong cách Zalo đã duyệt").click();
    await vi.waitFor(() => expect(host.textContent).not.toContain("Đặc điểm đã duyệt từ mẫu"));
    expect(writes.map(x => x.action)).toEqual(["propose", "approve", "forget"]);
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
