// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ZaloOfficialSetup } from "./ZaloOfficialSetup";

vi.mock("@/lib/setup-import", () => ({ localSetupImport: () => true }));
afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

function render() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(ZaloOfficialSetup)));
  const button = (name: string) => {
    const node = Array.from(host.querySelectorAll("button")).find(b => b.textContent === name);
    expect(node).toBeDefined();
    return node!;
  };
  return { host, button, close: () => { flushSync(() => root.unmount()); host.remove(); } };
}

it("hides pairing when the server does not grant the desktop pilot capability", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (path: string) => { paths.push(path); return Response.json({ enabled: true }); });
  const view = render();
  try {
    await vi.waitFor(() => expect(view.host.textContent).toContain("Official Zalo Bot"));
    expect(view.host.textContent).not.toContain("Private chat pairing");
    expect(paths).toEqual(["/api/zalo-official/probe"]);
  } finally { view.close(); }
});

it("confirms the provider sender/chat and retention explicitly, then requires a second action to revoke", async () => {
  setLocale("vi");
  let state = "ready";
  const writes: Record<string, unknown>[] = [];
  const expires = Date.now() + 30_000;
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    expect(init).toMatchObject({ mode: "same-origin", redirect: "error", cache: "no-store" });
    if (path.endsWith("/probe")) return Response.json({ enabled: true, pairingPilot: true });
    const action = init.body ? JSON.parse(String(init.body)) : undefined;
    if (action) {
      writes.push(action);
      state = action.action === "invite" ? "waiting" : action.action === "approve" ? "paired" : "unconfigured";
    }
    return Response.json({ state, ...(state === "unconfigured" ? {} : { accountId: "bot-test", revision: state }),
      ...(state === "waiting" ? { command: "/pair fixture-command", expires } : {}),
      ...(["candidate", "paired"].includes(state) ? { participant: { senderId: "fixture-sender", conversationId: "fixture-chat" } } : {}),
      ...(state === "paired" ? { retentionDays: 7, coverage: { count: 2, first: Date.now(), last: Date.now(), pollGaps: 0, timingIssues: 1 } } : {}) });
  });
  const view = render();
  try {
    await vi.waitFor(() => expect(view.host.textContent).toContain("Có thể cấp mã"));
    view.button("Cấp mã riêng").click();
    await vi.waitFor(() => expect(view.host.textContent).toContain("/pair fixture-command"));
    state = "candidate";
    view.button("Tải lại trạng thái").click();
    await vi.waitFor(() => expect(view.host.textContent).toContain("ID người gửi đã đối chiếu"));
    expect(view.host.textContent).not.toContain("fixture-command");
    const fields = Array.from(view.host.querySelectorAll("form")).at(-1)!.querySelectorAll("input");
    const type = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const approve = view.button("Duyệt ghép cặp");
    expect(approve.disabled).toBe(true);
    type(fields[0]!, "fixture-sender");
    type(fields[1]!, "another-chat");
    expect(approve.disabled).toBe(true);
    type(fields[1]!, "fixture-chat");
    await vi.waitFor(() => expect(approve.disabled).toBe(false));
    approve.click();
    await vi.waitFor(() => expect(view.host.textContent).toContain("Đang lưu 2 tin nhắn"));
    expect(view.host.textContent).toContain("Lịch sử có thể thiếu");
    view.button("Thu hồi endpoint").click();
    await vi.waitFor(() => view.button("Hủy")).then(b => b.click());
    expect(writes).toHaveLength(2);
    await vi.waitFor(() => view.button("Thu hồi endpoint")).then(b => b.click());
    await vi.waitFor(() => view.button("Thu hồi và xóa tin còn lưu")).then(b => b.click());
    await vi.waitFor(() => expect(view.host.textContent).toContain("Bot thử chưa có endpoint"));
    expect(writes).toEqual([{ action: "invite", revision: "ready" }, { action: "approve", revision: "candidate",
      senderId: "fixture-sender", conversationId: "fixture-chat", retentionDays: 7 }, { action: "revoke", revision: "paired" }]);
  } finally { view.close(); }
});
