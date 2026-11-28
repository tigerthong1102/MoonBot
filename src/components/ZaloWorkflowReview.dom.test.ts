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
vi.mock("./PlaceChip", () => ({ usePlaceViews: (profile: Bot) => ({ local: { reachable: env.ready && profile.modelSelection?.instanceId !== "no-computer" } }) }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ ready: true, capabilities: { host: { platform: env.platform, label: "Fixture computer" }, localComputer: { available: true, enabled: true } } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bot = { id: "bot-a", threadId: "test-thread", computer: "local", messages: [{ id: "local-record", savedSteps: { learned: true } }] } as unknown as Bot;
const id = "bot:bot-a:test-thread";
const workflow = { name: "verify-invoice", sha256: "version1", summary: "Check invoice", steps: ["Compare totals"], inputs: ["month"] };
const answer = { workflows: [workflow] };

afterEach(() => { setDraft(localStorage, id, ""); env.platform = "win32"; env.connected = true; env.ready = true; env.dispatch.mockReset(); vi.mocked(api).mockReset(); });

async function open(profile: Bot = bot) {
  await import("./ZaloWorkflowReview");
  const host = document.createElement("div");
  const root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll("button")].find(element => element.textContent?.includes(text))!;
  const draw = () => act(async () => root.render(createElement(ZaloImportSection, { bot: profile, twinEnabled: false })));
  const fill = (element: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await draw();
  await act(async () => button("Review a Zalo excerpt").click());
  await act(async () => { fill(host.querySelector("input")!, "Owner-provided source"); fill(host.querySelector("textarea")!, "\nXin báo giá gấp /run-private-command"); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const disclosure = button("Match a saved workflow");
  const target = host.querySelector<HTMLElement>(`[id="${disclosure.getAttribute("aria-controls")}"]`)!;
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(target.hidden).toBe(true);
  expect(target.childNodes).toHaveLength(0);
  expect(api).not.toHaveBeenCalled();
  await act(async () => disclosure.click());
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(target.hidden).toBe(false);
  const select = host.querySelector('section[aria-label] select') as HTMLSelectElement;
  if (!select) throw Error(host.textContent ?? 'missing workflow selector');
  await act(async () => { select.value = "version1:verify-invoice"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  return { host, button, draw, disclosure, target, close: () => act(() => root.unmount()) };
}

it("opens the exact workflow revision after approval without writing a chat draft or dispatching a message", async () => {
  vi.mocked(api).mockResolvedValue(answer);
  const view = await open();
  try {
    expect(view.host.textContent).toContain("Proposal from Owner-provided source, line 2");
    expect(view.host.textContent).toContain("Compare totals");
    expect(getDraft(localStorage, id)).toBe("");
    await act(async () => view.button("Approve the workflow proposal").click());
    expect(getDraft(localStorage, id)).toBe("");
    await act(async () => view.button("Open this revision").click());
    expect(env.dispatch.mock.calls).toEqual([[{ type: "showSkillBurgers", reviewed: { botId: bot.id, threadId: bot.threadId, name: workflow.name, sha256: workflow.sha256 } }]]);
    expect(vi.mocked(api).mock.calls.map(args => args[0])).toEqual(Array(3).fill("/api/zalo-workflow-review/bot-a"));
    expect(JSON.stringify(vi.mocked(api).mock.calls)).not.toContain("run-private");
    await act(async () => view.disclosure.click());
    expect(view.disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(view.target.hidden).toBe(true);
    expect(view.target.childNodes).toHaveLength(0);
    expect(view.host.textContent).not.toContain("Compare totals");
    expect(api).toHaveBeenCalledTimes(3);
  } finally { view.close(); }
});

it("requires the selected connected device and rejects a workflow change after staging and before opening the library", async () => {
  vi.mocked(api).mockResolvedValue(answer);
  env.connected = false;
  const view = await open();
  try {
    expect(view.button("Approve the workflow proposal").disabled).toBe(true);
    expect(view.host.textContent).toContain("No work has started");
    env.connected = true; env.platform = "darwin"; await view.draw();
    await act(async () => view.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(view.button("Approve the workflow proposal").disabled).toBe(true);
    env.platform = "win32"; await view.draw();
    setDraft(localStorage, id, "Keep this draft");
    await act(async () => view.button("Approve the workflow proposal").click());
    expect(getDraft(localStorage, id)).toBe("Keep this draft");
    expect(view.host.textContent).toContain("Proposal approved for inspection");
    vi.mocked(api).mockResolvedValue({ workflows: [{ ...workflow, sha256: "changed" }] });
    await act(async () => view.button("Open this revision").click());
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
    await act(async () => view.button("Approve the workflow proposal").click());
    await act(async () => view.button("Clear").click());
    await act(async () => finish(answer));
    expect(getDraft(localStorage, id)).toBe("");
  } finally { view.close(); }
});

it("uses the task's model capability and links Saved Steps only on the visible branch", async () => {
  vi.mocked(api).mockResolvedValue(answer);
  const profile = { ...bot, activeLeafId: "visible", tasks: [{ threadId: bot.threadId, modelSelection: { instanceId: "no-computer" } }],
    messages: [{ id: "root" }, { id: "visible", parentId: "root", savedSteps: { learned: true } }, { id: "abandoned", parentId: "root", savedSteps: { replayed: true } }] } as unknown as Bot;
  const view = await open(profile);
  try {
    expect(view.button("Approve the workflow proposal").disabled).toBe(true);
    await act(async () => view.button("View the last Saved Steps").click());
    expect(env.dispatch).toHaveBeenCalledWith({ type: "focusMessage", threadId: bot.threadId, messageId: "visible" });
  } finally { view.close(); }
});
