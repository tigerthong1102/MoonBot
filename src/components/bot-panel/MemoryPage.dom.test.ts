// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: {} }, dispatch: vi.fn() }) };
});

const { MemoryPage } = await import("./pages");
const { AUTOSAVE_MS } = await import("./MemoryText");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bot = (threadId: string, extra: Partial<Bot> = {}) => ({ id: "counsel", threadId, name: "Counsel", title: "", description: "", notifications: true, color: "green",
  unread: false, messages: [], modelSelection: { instanceId: "x", model: "x" }, ...extra }) as unknown as Bot;
const files: Record<string, string> = {};
const scoped = new Set<string>();
const denied = new Set<string>();
const puts: Array<{ url: string; text: string; expectedHash?: string }> = [];
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const hash = (text: string) => `h${text.length}:${text.split("\n").length}`;
const threadOf = (url: URL) => /\/memory\/thread\/([\w-]+)$/.exec(url.pathname)?.[1];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  puts.length = 0;
  for (const key of Object.keys(files)) delete files[key];
  scoped.clear();
  denied.clear();
  files["MEMORY.md"] = "- Prefers short replies.\n";
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://x");
    const thread = threadOf(url);
    if (thread && denied.has(thread)) return reply(404, { error: "no such conversation" });
    const path = thread ? `memory/threads/${thread}.md` : url.searchParams.get("path") ?? "MEMORY.md";
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { path?: string; text: string; expectedHash?: string };
      const target = body.path ?? path;
      puts.push({ url: url.pathname, text: body.text, expectedHash: body.expectedHash });
      const current = files[target] ?? "";
      if (body.expectedHash !== hash(current)) return reply(409, { error: "conflict", current, currentHash: hash(current) });
      files[target] = body.text;
      return reply(200, { path: target, text: body.text, hash: hash(body.text), exists: true, scoped: Boolean(thread && scoped.has(thread)), overview: {} });
    }
    if (url.pathname.endsWith("/memory")) return reply(200, { topics: [], logs: [] });
    const text = files[path] ?? "";
    return reply(200, { path, text, hash: hash(text), exists: path in files, ...(thread ? { scoped: scoped.has(thread) } : {}) });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
const show = async (shown: Bot) => {
  await act(async () => root.render(createElement(MemoryPage, { bot: shown, derived: {} as never })));
  await settle();
};
const field = (scope: string) => host.querySelector<HTMLTextAreaElement>(`[data-memory-scope="${scope}"] textarea`);
const type = (scope: string, text: string) => act(() => {
  const element = field(scope)!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
const autosave = async () => {
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS + 10); });
  await settle();
};

it("keeps the bot-wide notes in the main conversation without showing a thread editor", async () => {
  await show(bot("main"));
  expect(field("thread")).toBeNull();
  expect(host.textContent).toContain("Prefers short replies.");
});

it("edits the selected conversation's notes independently of the bot-wide file", async () => {
  scoped.add("acme");
  files["memory/threads/acme.md"] = "- 2026-11-22 · Acme: NDA, 2-year term\n";
  await show(bot("acme"));
  const scopes = [...host.querySelectorAll("[data-memory-scope]")].map((element) => element.getAttribute("data-memory-scope"));
  expect(scopes).toEqual(["thread"]);
  expect(host.textContent).toContain("This thread");
  expect(host.textContent).toContain("Prefers short replies.");
  await type("thread", "- 2026-11-22 · Acme: NDA, 3-year term\n");
  await autosave();
  expect(puts.map((put) => put.url)).toEqual(["/api/bots/counsel/memory/thread/acme"]);
  expect(files["memory/threads/acme.md"]).toBe("- 2026-11-22 · Acme: NDA, 3-year term\n");
  expect(files["MEMORY.md"]).toBe("- Prefers short replies.\n");
});

it("keeps the draft and the saved notes separate on a version conflict", async () => {
  scoped.add("acme");
  await show(bot("acme"));
  files["memory/threads/acme.md"] = "- Counterparty is Supermouse Ltd\n";
  await type("thread", "- Signing on Friday\n");
  await autosave();
  expect(puts).toHaveLength(1);
  expect(field("thread")?.value).toBe("- Signing on Friday\n");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("changed this file");
  await autosave();
  expect(puts).toHaveLength(1);
  expect(files["memory/threads/acme.md"]).toBe("- Counterparty is Supermouse Ltd\n");
});

it("says memory is off and nothing else when it is off", async () => {
  await show(bot("main", { memoryEnabled: false }));
  expect(host.textContent).toBe("Memory is off for Counsel.");
  expect(host.querySelector("textarea")).toBeNull();
});

it("shows only the active conversation's notes after switching", async () => {
  scoped.add("acme");
  scoped.add("other");
  files["memory/threads/acme.md"] = "Acme notes";
  files["memory/threads/other.md"] = "Other notes";
  await show(bot("acme"));
  expect(field("thread")?.value).toBe("Acme notes");
  await show(bot("other"));
  expect(field("thread")?.value).toBe("Other notes");
});

it("clears displayed notes when a new read finds the conversation is no longer accessible", async () => {
  scoped.add("acme");
  files["memory/threads/acme.md"] = "Acme notes";
  await show(bot("acme"));
  expect(field("thread")?.value).toBe("Acme notes");

  denied.add("acme");
  await show(bot("acme", { busy: true }));
  expect(field("thread")).toBeNull();
});
