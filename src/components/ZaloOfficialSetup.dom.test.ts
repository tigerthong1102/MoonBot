// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ZaloOfficialSetup } from "./ZaloOfficialSetup";

vi.mock("@/lib/setup-import", () => ({ localSetupImport: () => true }));
afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

it("shows the verified identity and inconclusive webhook separately and clears the token immediately", async () => {
  setLocale("vi");
  const requests: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
    requests.push(init);
    return Response.json(init.method === "POST" ? { identityVerified: true, accountId: "paired", webhookConfigured: null } : { enabled: true });
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ZaloOfficialSetup)));
    const field = await vi.waitFor(() => {
      const node = host.querySelector("input");
      expect(node).not.toBeNull();
      return node!;
    });
    field.value = "123:synthetic";
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(field.value).toBe("");
    await vi.waitFor(() => expect(host.textContent).toContain("Zalo đã xác minh bot paired."));
    expect(host.textContent).toContain("Chưa xác minh được webhook");
    expect(host.textContent).not.toContain("synthetic");
    expect(requests.at(-1)).toMatchObject({ method: "POST", mode: "same-origin", cache: "no-store", redirect: "error" });
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
