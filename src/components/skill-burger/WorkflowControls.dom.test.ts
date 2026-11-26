// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SavedWorkflow } from "@/lib/skill-burger";
import type { WorkflowWait } from "../../../shared/skill-burger/approval";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), list: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/api", () => ({ api: fixture.api }));
vi.mock("@/state/store-select", () => ({ useStoreDispatch: () => fixture.dispatch }));
vi.mock("@/lib/skill-burger", async original => ({ ...await original<typeof import("@/lib/skill-burger")>(), useSavedBurgers: fixture.list, readBurgerRevision: fixture.read, saveBurgerControls: fixture.save }));
const { SavedWorkflowsCard } = await import("./SavedWorkflowsCard");
const { WorkflowWaits } = await import("./WorkflowWaits");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("edits adjacent reads and requires team sharing consent before saving the pinned revision", async () => {
  const skill: SavedWorkflow = { name: "fixture", summary: "Fixture", everyChat: false, botId: "bot", layers: [], args: [], sha256: "abc", savedAt: "" };
  fixture.read.mockResolvedValue({ sha256: "current", workflow: { version: 1, args: {}, summary: "Fixture", steps: [
    ["mail", "GMAIL_FETCH_EMAILS"], ["profile", "GMAIL_GET_PROFILE"], ["send", "GMAIL_SEND_EMAIL"],
  ].map(([id, tool]) => ({ id, kind: "app", app: "gmail", tool, args: {}, label: id })) } });
  fixture.list.mockReturnValue({ skills: [skill] });
  fixture.save.mockResolvedValue({ ...skill, sha256: "def" });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SavedWorkflowsCard, { botId: "bot", threadId: "room", team: true })));
    const row = host.querySelector<HTMLButtonElement>("button[aria-controls]")!;
    await act(async () => row.click());
    const toggle = [...host.querySelectorAll<HTMLButtonElement>("button[aria-controls]")].find(button => button !== row)!;
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    await act(async () => toggle.click());
    expect(panel.hidden).toBe(true);
    await act(async () => toggle.click());
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(panel);
    const forms = host.querySelectorAll("fieldset");
    expect(forms).toHaveLength(3);
    const parallel = forms[1]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(forms[2]!.querySelector('input[type="checkbox"]')).toBeNull();
    await act(async () => parallel.click());
    await act(async () => row.click());
    await act(async () => row.click());
    expect(host.contains(parallel)).toBe(true);
    expect(parallel.checked).toBe(true);
    const save = panel.querySelector<HTMLButtonElement>("button:not([aria-controls])")!;
    expect(save.disabled).toBe(true);
    const share = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
    await act(async () => share.click());
    await act(async () => save.click());
    expect(fixture.save).toHaveBeenCalledWith(skill, "current", [{ id: "mail" }, { id: "profile", parallelWithPrevious: true }, { id: "send" }], true);
  } finally { act(() => root.unmount()); host.remove(); }
});

it("sends the pinned continuation only after the review succeeds, and hides actions for uncertain writes", async () => {
  fixture.api.mockReset(); fixture.dispatch.mockClear();
  const row: WorkflowWait = { run: "run", botId: "A", token: "paused-token", reviewHash: "a".repeat(64), name: "Fixture", step: "Send", action: "send to Alice", message: "Check recipient", state: "pending" };
  let state: WorkflowWait["state"] = "pending";
  let refuse = true;
  fixture.api.mockImplementation(async (_path: string, opts: RequestInit) => {
    if (opts.method !== "POST") return { waits: [{ ...row, state }] };
    if (refuse) throw new Error("Decision refused");
    state = "approved"; return { ok: true };
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const show = (busy: boolean) => act(async () => root.render(createElement(WorkflowWaits, { botId: "A", threadId: "T", busy })));
  try {
    await show(true);
    expect(host.querySelector<HTMLButtonElement>("button:not([aria-controls])")!.disabled).toBe(true);
    await show(false);
    await act(async () => host.querySelector<HTMLButtonElement>("button:not([aria-controls])")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Decision refused");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    refuse = false;
    await act(async () => host.querySelector<HTMLButtonElement>("button:not([aria-controls])")!.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/A/workflow-approvals?threadId=T", { method: "POST", body: JSON.stringify({ token: row.token, decision: "allow", reviewHash: row.reviewHash }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "send", botId: "A", threadId: "T", text: expect.stringContaining(row.token) });
    state = "interrupted";
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.querySelector<HTMLButtonElement>("button:not([aria-controls])")).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeTruthy();
  } finally { act(() => root.unmount()); host.remove(); }
});

it("addresses the originating member and thread when a person approves in a room", async () => {
  fixture.api.mockReset(); fixture.dispatch.mockClear();
  const wait: WorkflowWait = { run: "run", botId: "member", token: "pin", name: "report", step: "write", action: "publish", message: "approve?", state: "pending" };
  fixture.api.mockImplementation(async (_path: string, opts: RequestInit) => opts.method === "POST" ? { ok: true } : { waits: [wait] });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(WorkflowWaits, { room: { id: "room", members: [{ id: "member", name: "Viv" }] }, threadId: "room-topic", busy: false })));
    await act(async () => host.querySelector<HTMLButtonElement>("button:not([aria-controls])")!.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/groups/room/workflow-approvals?threadId=room-topic", expect.anything());
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/member/workflow-approvals?threadId=room-topic", { method: "POST", body: JSON.stringify({ token: "pin", decision: "allow" }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "sendGroup", groupId: "room", threadId: "room-topic", text: expect.stringMatching(/^@Viv .*pin/), mentions: ["member"] });
  } finally { act(() => root.unmount()); host.remove(); }
});

it("ignores unsupported approvals and clears old cards when a server lacks the wait list", async () => {
  fixture.api.mockReset();
  const row: WorkflowWait = { run: "r", botId: "A", token: "p", name: "Review", step: "Export", message: "Allow export?", action: "Export report", state: "pending" };
  let response: unknown = { waits: [null, { ...row, state: "future-state" }, { ...row, token: null }, { ...row, action: "" }, row] };
  fixture.api.mockImplementation(async () => response);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(WorkflowWaits, { botId: "A", threadId: "T", busy: false })));
    expect(host.querySelectorAll("strong")).toHaveLength(1);
    expect(host.querySelector("pre")?.textContent).toBe("Export report");
    for (const unsupported of [{ ok: true }, { waits: {} }, null]) {
      response = unsupported;
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      expect(host.childElementCount).toBe(0);
    }
    response = { waits: [{ ...row, action: "", state: "unavailable" }] };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.querySelector('[role="status"]')).toBeTruthy();
    expect(host.querySelector<HTMLButtonElement>("button:not([aria-controls])")).toBeNull();
  } finally { act(() => root.unmount()); }
});
