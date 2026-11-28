// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/state/api";
import type { Bot } from "@/state/store";
import { getDraft, setDraft } from "@/lib/drafts";
import { ZaloImportSection } from "./ZaloImportSection";
const env = vi.hoisted(() => ({ connected: true, platform: "win32", dispatch: vi.fn(), ready: true }));
vi.mock("@/state/api", async load => ({ ...await load<object>(), api: vi.fn() }));
vi.mock("@/state/store", async load => ({ ...await load<object>(), useStore: () => ({ state: { connected: env.connected, selectedId: "bot-a" }, dispatch: env.dispatch }) }));
vi.mock("./PlaceChip", () => ({ usePlaceViews: () => ({ local: { reachable: env.ready } }) }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ ready: true, capabilities: { host: { platform: env.platform, label: "Fixture computer" }, localComputer: { available: true, enabled: true } } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bot = { id: "bot-a", threadId: "test-thread", computer: "local", messages: [{ id: "local-record", savedSteps: { learned: true } }] } as unknown as Bot;
const id = "bot:bot-a:test-thread";
const workflow = { name: "verify-invoice", sha256: "version1", summary: "Check invoice", steps: ["Compare totals"], inputs: ["month"] };
const answer = { workflows: [workflow] };

afterEach(() => { setDraft(localStorage, id, ""); env.platform = "win32"; env.connected = true; env.ready = true; env.dispatch.mockReset(); vi.mocked(api).mockReset(); });

async function open() {
  await import("./ZaloWorkflowReview");
  const host = document.createElement("div");
  const root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll("button")].find(element => element.textContent?.includes(text))!;
  const draw = () => act(async () => root.render(createElement(ZaloImportSection, { bot, twinEnabled: false })));
  const fill = (element: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await draw();
  await act(async () => button("Review a Zalo excerpt").click());
  await act(async () => { fill(host.querySelector("input")!, "Owner-provided source"); fill(host.querySelector("textarea")!, "\nXin báo giá gấp /run-private-command"); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => button("Match a saved workflow").click());
  const select = host.querySelector('section[aria-label] select') as HTMLSelectElement;
  if (!select) throw Error(host.textContent ?? 'missing workflow selector');
  await act(async () => { select.value = "version1:verify-invoice"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  return { host, button, draw, close: () => act(() => root.unmount()) };
}

it("prepares the catalog command after owner approval and opens the regular chat without dispatching the message or importing the excerpt", async () => {
  vi.mocked(api).mockResolvedValue(answer);
  const view = await open();
  try {
    expect(view.host.textContent).toContain("Proposal from Owner-provided source, line 2");
    expect(view.host.textContent).toContain("Compare totals");
    expect(getDraft(localStorage, id)).toBe("");
    await act(async () => view.button("Approve and prepare").click());
    expect(getDraft(localStorage, id)).toBe("/verify-invoice");
    await act(async () => view.button("Open the chat draft").click());
    expect(env.dispatch.mock.calls.map(args => args[0].type)).toEqual(["toggleAppSettings", "toggleSettings", "showChat"]);
    expect(vi.mocked(api).mock.calls.map(args => args[0])).toEqual(["/api/zalo-workflow-review/bot-a", "/api/zalo-workflow-review/bot-a"]);
    expect(JSON.stringify(vi.mocked(api).mock.calls)).not.toContain("run-private");
  } finally { view.close(); }
});

it("requires the selected connected device, keeps an occupied composer intact and rechecks the workflow revision", async () => {
  vi.mocked(api).mockResolvedValue(answer);
  env.connected = false;
  const view = await open();
  try {
    expect(view.button("Approve and prepare").disabled).toBe(true);
    expect(view.host.textContent).toContain("No work has started");
    env.connected = true; env.platform = "darwin"; await view.draw();
    await act(async () => view.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(view.button("Approve and prepare").disabled).toBe(true);
    env.platform = "win32"; await view.draw();
    setDraft(localStorage, id, "Keep this draft");
    await act(async () => view.button("Approve and prepare").click());
    expect(getDraft(localStorage, id)).toBe("Keep this draft");
    expect(view.host.textContent).toContain("already has a draft");
    vi.mocked(api).mockResolvedValue({ workflows: [{ ...workflow, sha256: "changed" }] });
    await act(async () => view.button("Approve and prepare").click());
    expect(view.host.textContent).toContain("workflow changed");
    expect(env.dispatch).not.toHaveBeenCalled();
  } finally { view.close(); }
});

it("invalidates an in-flight approval when the operator clears the source", async () => {
  vi.mocked(api).mockResolvedValueOnce(answer);
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = await open();
  try {
    await act(async () => view.button("Approve and prepare").click());
    await act(async () => view.button("Clear").click());
    await act(async () => finish(answer));
    expect(getDraft(localStorage, id)).toBe("");
  } finally { view.close(); }
});
