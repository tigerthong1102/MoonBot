// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { isDraftAttachmentPending } from "@/lib/drafts";
import type { Message } from "@/state/store";
import { ComposerSourceLines } from "./ComposerSourceLines";

it("pins a selected file and drops an unfinished attachment after switching conversations", async () => {
  const message = { id: "m1", kind: "text", role: "bot", text: "Source [invoices](file:///workspace/invoices.csv) and [website](https://example.test/other.csv)" } as Message;
  const attached = vi.fn();
  const sha256 = "f".repeat(64);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = (threadId: string) => act(async () => root.render(createElement(ComposerSourceLines, { key: threadId, draftId: threadId, threadId, messages: [message], attach: attached })));
  const ok = { ok: true, json: async () => ({ text: "original source bytes", sha256 }) };
  let finish!: (value: typeof ok) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(ok).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await render("mine");
    expect(host.querySelector("select")?.textContent).toBe("invoices.csv");
    await act(async () => host.querySelector("button")!.click());
    expect(attached).toHaveBeenCalledWith(expect.objectContaining({ resource: { threadId: "mine", messageId: "m1", name: "invoices.csv", path: "file:///workspace/invoices.csv", sha256, start: 1, end: 1 } }));
    expect(attached.mock.calls[0][0].text).not.toContain("original source bytes");
    await act(async () => host.querySelector("button")!.click());
    expect(isDraftAttachmentPending("mine")).toBe(true);
    await render("other");
    expect(isDraftAttachmentPending("other")).toBe(false);
    await act(async () => finish(ok));
    expect(attached).toHaveBeenCalledTimes(1);
    expect(isDraftAttachmentPending("mine")).toBe(false);
    fetcher.mockRejectedValueOnce(new Error("File removed"));
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("File removed");
    expect(isDraftAttachmentPending("other")).toBe(false);
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
