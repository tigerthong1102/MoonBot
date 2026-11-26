// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/api";
import SourceLibrary from "./SourceLibrary";
import { currentLibrary } from "./source-sync";
import type { Index } from "./source-index";

vi.mock("@/state/api", async load => ({ ...await load<typeof import("@/state/api")>(), api: vi.fn() }));
vi.mock("./source-cache", () => ({ libraryKey: async () => "viewer-thread", readLibrary: vi.fn() }));
vi.mock("./source-sync", () => ({ currentLibrary: vi.fn(), readWatch: async () => null, onSourceSync: () => () => {} }));

it("posts only explicitly displayed evidence, keeps a stable retry on older hosts and never falls back to a chat send", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host), close = vi.fn();
  const path = "Handbook.txt", text = "A limit of ten. This is document content.";
  const index: Index = { docs: new Map([[path, { path, digest: "f".repeat(64), file: new File([text], path),
    passages: [{ page: 1, paragraph: 1, start: 0, text }] }]]), changes: [] };
  vi.mocked(currentLibrary).mockResolvedValue(index);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  vi.mocked(api).mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce({}).mockResolvedValueOnce({ ok: true });
  try {
    await act(async () => { root.render(createElement(SourceLibrary, { bot: { id: "bot", threadId: "thread" } as Bot, open: true, close })); });
    const input = host.querySelector("input[type=search]") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "What is the limit?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const ask = () => Array.from(host.querySelectorAll("button")).find(b => b.textContent === t("knowledge.ask", { count: 1 }))!;
    await act(async () => ask().click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("knowledge.sendError"));
    expect(close).not.toHaveBeenCalled();
    await act(async () => ask().click());
    expect(close).not.toHaveBeenCalled();
    await act(async () => ask().click());
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api).mock.calls.map(([url]) => url)).toEqual(Array(3).fill("/api/bots/bot/knowledge-answers"));
    const bodies = vi.mocked(api).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0]).toEqual({ question: "What is the limit?", threadId: "thread", sendId: expect.any(String),
      evidence: [{ path, digest: "f".repeat(64), start: 0, page: 1, paragraph: 1, text }] });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map(), changes: [] });
    await act(async () => ask().click());
    expect(api).toHaveBeenCalledTimes(3);
    expect(ask()).toBeUndefined();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("knowledge.answerChanged"));
  } finally {
    await act(async () => root.unmount());
    host.remove(); vi.unstubAllGlobals();
  }
});

it("shows the appropriate recovery for each source answer refusal without exposing raw server messages", async () => {
  vi.resetAllMocks();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), close = vi.fn();
  const path = "Policy.md", text = "Company policy";
  vi.mocked(currentLibrary).mockResolvedValue({ docs: new Map([[path, { path, file: new File([text], path), digest: "a".repeat(64),
    passages: [{ page: 1, paragraph: 1, start: 0, text }] }]]), changes: [] });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    await act(async () => root.render(createElement(SourceLibrary, { bot: { id: "bot", threadId: "thread" } as Bot, open: true, close })));
    const input = host.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "policy");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const ask = [...host.querySelectorAll("button")].find(b => b.textContent === t("knowledge.ask", { count: 1 }))!;
    for (const [error, key] of [
      [new ApiError("sensitive", 409), "knowledge.answerBusy"], [new ApiError("sensitive", 429), "knowledge.answerBusy"],
      [new ApiError("sensitive", 422), "knowledge.answerModel"], [new ApiError("sensitive", 403), "knowledge.answerAccess"],
      [new ApiError("sensitive", 409, { code: "spend_cap" }), "knowledge.answerLimit"],
      [new ApiError("sensitive", 409, { code: "moved" }), "knowledge.answerMoved"],
      [new TypeError("sensitive"), "knowledge.answerNetwork"], [new DOMException("sensitive", "TimeoutError"), "knowledge.answerNetwork"],
    ] as const) {
      vi.mocked(api).mockRejectedValueOnce(error);
      await act(async () => ask.click());
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(t(key));
      expect(input.value).toBe("policy");
      expect(close).not.toHaveBeenCalled();
    }
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
