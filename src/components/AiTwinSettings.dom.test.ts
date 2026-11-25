// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/state/api";
import { AiTwinSettings } from "./AiTwinSettings";

vi.mock("@/state/api", async (load) => ({ ...await load<object>(), api: vi.fn() }));

const apiMock = vi.mocked(api);
const renders: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  await act(async () => { for (const root of renders.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  apiMock.mockReset();
  vi.unstubAllGlobals();
});

async function mount() {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  renders.push(root);
  await act(async () => root.render(createElement(AiTwinSettings)));
  return target;
}

function button(scope: ParentNode, text: string) {
  const found = Array.from(scope.querySelectorAll("button")).find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Button absent: ${text}`);
  return found;
}

it("is absent when the desktop does not enable the feature", async () => {
  apiMock.mockRejectedValueOnce(new ApiError("not_found", 404));
  expect((await mount()).textContent).toBe("");
});

it("keeps setup opt-in without crypto.randomUUID, updates the profile on acknowledgment, and cancels deletion", async () => {
  apiMock.mockResolvedValueOnce({ twin: null, creationEpoch: "initial" });
  const profile = await mount();
  expect(apiMock.mock.calls.map((call) => call[1]?.method ?? "GET")).toEqual(["GET"]);
  await act(async () => button(profile, "Create AI Twin").click());
  expect(apiMock).toHaveBeenCalledTimes(1);
  const input = profile.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Thông AI");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  apiMock.mockResolvedValueOnce({ creationEpoch: "initial", twin: {
    id: "fake", name: "Thông AI", style: "", revision: 1, paused: false, createdAt: 1, updatedAt: 1,
  } });
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  await act(async () => button(profile, "Create AI Twin").click());
  expect(JSON.parse(String(apiMock.mock.calls[1]![1]?.body))).toMatchObject({
    name: "Thông AI", createConsent: true, creationEpoch: "initial",
    creationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  });
  expect(profile.textContent).toContain("Thông AI");
  await act(async () => button(profile, "Delete AI Twin").click());
  const dialog = document.querySelector("[role=alertdialog], [role=dialog]");
  expect(dialog).not.toBeNull();
  await act(async () => button(dialog!, "Cancel").click());
  expect(apiMock).toHaveBeenCalledTimes(2);
});

it("shows the latest profile after a conflicting save before another edit is allowed", async () => {
  const previous = { id: "same", name: "Original AI", style: "Use lists.", revision: 1, paused: false, createdAt: 1, updatedAt: 1 };
  apiMock.mockResolvedValueOnce({ twin: previous, creationEpoch: "initial" });
  const profile = await mount();
  await act(async () => button(profile, "Edit profile").click());
  const input = profile.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Stale edit");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  apiMock.mockRejectedValueOnce(new ApiError("twin_changed", 409, { error: "twin_changed" }));
  apiMock.mockResolvedValueOnce({ twin: { ...previous, name: "Latest AI", style: "Use short paragraphs.", revision: 2 }, creationEpoch: "initial" });
  await act(async () => button(profile, "Save").click());
  expect(profile.querySelector("input")).toBeNull();
  expect(profile.textContent).toContain("Latest AI");
  expect(profile.textContent).not.toContain("Stale edit");
  await act(async () => button(profile, "Edit profile").click());
  expect(profile.querySelector("input")?.value).toBe("Latest AI");
  expect(profile.querySelector("textarea")?.value).toBe("Use short paragraphs.");
});

it("exposes a keyboard-button disclosure linked to the preview panel", async () => {
  apiMock.mockResolvedValueOnce({ creationEpoch: "initial", twin: {
    id: "test", name: "Example AI", style: "", revision: 1, paused: false, createdAt: 1, updatedAt: 1,
  } });
  const profile = await mount();
  const toggle = button(profile, "Try a reply");
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(panel?.hidden).toBe(true);
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(panel?.hidden).toBe(false);
  await act(async () => toggle.click());
  expect(panel?.hidden).toBe(true);
});
