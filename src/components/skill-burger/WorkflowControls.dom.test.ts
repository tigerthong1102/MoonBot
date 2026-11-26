// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SavedWorkflow } from "@/lib/skill-burger";
import type { WorkflowWait } from "../../../shared/skill-burger/approval";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@/state/api", () => ({ api: fixture.api }));
vi.mock("@/state/store-select", () => ({ useStoreDispatch: () => fixture.dispatch }));
vi.mock("@/lib/skill-burger", () => ({ readBurgerRevision: fixture.read, saveBurgerControls: fixture.save }));
const { WorkflowControls } = await import("./WorkflowControls");
const { WorkflowWaits } = await import("./WorkflowWaits");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("edits adjacent reads and requires team sharing consent before saving the pinned revision", async () => {
  const skill: SavedWorkflow = { name: "fixture", summary: "Fixture", everyChat: false, botId: "bot", layers: [], args: [], sha256: "abc", savedAt: "" };
  fixture.read.mockResolvedValue({ sha256: "current", workflow: { version: 1, args: {}, summary: "Fixture", steps: [
    ["mail", "GMAIL_FETCH_EMAILS"], ["profile", "GMAIL_GET_PROFILE"], ["send", "GMAIL_SEND_EMAIL"],
  ].map(([id, tool]) => ({ id, kind: "app", app: "gmail", tool, args: {}, label: id })) } });
  fixture.save.mockResolvedValue({ ...skill, sha256: "def" });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(WorkflowControls, { skill, team: true })));
    const details = host.querySelector("details")!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle", { bubbles: true })); });
    const forms = host.querySelectorAll("fieldset");
    expect(forms).toHaveLength(3);
    const parallel = forms[1]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(forms[2]!.querySelector('input[type="checkbox"]')).toBeNull();
    await act(async () => parallel.click());
    const save = host.querySelector<HTMLButtonElement>("button")!;
    expect(save.disabled).toBe(true);
    const share = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
    await act(async () => share.click());
    await act(async () => save.click());
    expect(fixture.save).toHaveBeenCalledWith(skill, "current", [{ id: "mail" }, { id: "profile", parallelWithPrevious: true }, { id: "send" }], true);
  } finally { act(() => root.unmount()); host.remove(); }
});

it("sends the pinned continuation only after the review succeeds, and hides actions for uncertain writes", async () => {
  fixture.api.mockReset(); fixture.dispatch.mockClear();
  const row: WorkflowWait = { run: "run", botId: "A", token: "paused-token", name: "Fixture", step: "Send", action: "send to Alice", message: "Check recipient", state: "pending" };
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
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    await show(false);
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Decision refused");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    refuse = false;
    await act(async () => host.querySelector("button")!.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/A/workflow-approvals?threadId=T", { method: "POST", body: JSON.stringify({ token: row.token, decision: "allow" }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "send", botId: "A", threadId: "T", text: expect.stringContaining(row.token) });
    state = "interrupted";
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.querySelector("button")).toBeNull();
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
    await act(async () => host.querySelector("button")!.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/groups/room/workflow-approvals?threadId=room-topic", expect.anything());
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/member/workflow-approvals?threadId=room-topic", { method: "POST", body: JSON.stringify({ token: "pin", decision: "allow" }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "sendGroup", groupId: "room", threadId: "room-topic", text: expect.stringMatching(/^@Viv .*pin/), mentions: ["member"] });
  } finally { act(() => root.unmount()); host.remove(); }
});
