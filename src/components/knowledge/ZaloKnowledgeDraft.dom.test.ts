// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "@/state/api";
import { brainOwner, evidenceReader, type VerifiedPage } from "./brain";
import { withCurrentBrainPage } from "./brain-erasure";
import { ZaloKnowledgeDraft } from "./ZaloKnowledgeDraft";

vi.mock("@/state/api", async load => ({ ...await load<object>(), api: vi.fn() }));
vi.mock("./brain-erasure", () => ({ withCurrentBrainPage: vi.fn(async (_page: unknown, signal: AbortSignal, action: () => unknown) => { signal.throwIfAborted(); return action(); }) }));
vi.mock("./brain", async load => ({ ...await load<object>(), brainOwner: vi.fn(), evidenceReader: vi.fn() }));

it.each(["source withdrawn", "page erased before dispatch", "page erased while waiting"])("checks both sources and the current page for %s", async scenario => {
  vi.clearAllMocks();
  const host = document.createElement("div");
  const root = createRoot(host);
  const source = { kind: "document" as const, threadId: "test-thread", path: "policy.txt", digest: "a".repeat(64), start: 0 };
  const item: VerifiedPage = { page: { id: "policy", version: 1, owner: "test-owner", approvedAt: 1, title: "Billing", body: "summary", kind: "procedure", source },
    evidence: { source, label: "policy.txt · 2", quote: "Only the approved excerpt", citations: [] } };
  vi.mocked(brainOwner).mockResolvedValue("test-owner");
  const reread = vi.fn().mockResolvedValue(item.evidence);
  vi.mocked(evidenceReader).mockReturnValue(reread);
  vi.mocked(api).mockResolvedValueOnce({ twin: { id: "test", revision: 1 }, preview: { name: "Local model", model: "fixture", key: "pin" } });
  const viewSignal = new AbortController().signal;
  const press = () => act(async () => host.querySelector("button")!.click());
  try {
    await act(async () => root.render(createElement(ZaloKnowledgeDraft, {
      excerpt: { source: "Chat mẫu", line: 4, text: "A synthetic question" }, item, viewSignal,
    })));
    await press();
    expect(evidenceReader).toHaveBeenCalledWith(item.page.owner, viewSignal);
    expect(api).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Local model");
    expect(host.textContent).toContain("Chat mẫu");
    expect(host.textContent).toContain(item.evidence.quote);
    if (scenario === "page erased before dispatch") {
      vi.mocked(withCurrentBrainPage).mockRejectedValueOnce(new Error("page_changed"));
      await press();
      expect(api).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="alert"]')).toBeTruthy();
      return;
    }
    vi.mocked(api).mockImplementationOnce(async () => {
      if (scenario === "source withdrawn") reread.mockResolvedValue(null);
      else vi.mocked(withCurrentBrainPage).mockRejectedValueOnce(new Error("page_changed"));
      return { draft: "obsolete answer" };
    });
    await press();
    const sent = JSON.parse(vi.mocked(api).mock.calls[1]![1]!.body as string);
    expect(sent.zaloEvidence).toEqual({ citation: item.evidence.label, quote: item.evidence.quote });
    expect(sent.zaloSource).toEqual({ source: "Chat mẫu", line: 4 });
    expect(host.textContent).not.toContain("obsolete answer");
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
  } finally { await act(async () => root.unmount()); }
});
