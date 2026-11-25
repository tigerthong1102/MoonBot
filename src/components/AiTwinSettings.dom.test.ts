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

it("keeps setup opt-in, updates the profile on acknowledgment, and cancels deletion", async () => {
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
  await act(async () => button(profile, "Create AI Twin").click());
  expect(JSON.parse(String(apiMock.mock.calls[1]![1]?.body))).toMatchObject({
    name: "Thông AI", createConsent: true, creationEpoch: "initial", creationId: expect.any(String),
  });
  expect(profile.textContent).toContain("Thông AI");
  await act(async () => button(profile, "Delete AI Twin").click());
  const dialog = document.querySelector("[role=alertdialog], [role=dialog]");
  expect(dialog).not.toBeNull();
  await act(async () => button(dialog!, "Cancel").click());
  expect(apiMock).toHaveBeenCalledTimes(2);
});
