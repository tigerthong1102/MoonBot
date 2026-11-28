// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/state/api";
import { AI_TWIN_FORGET_MANY_PATH, type AiTwinLesson, type AiTwinProfile } from "../../shared/ai-twin";
import { AiTwinLessons } from "./AiTwinLessons";

vi.mock("@/state/api", async (load) => ({ ...await load<object>(), api: vi.fn() }));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => { for (const root of roots.splice(0)) root.unmount(); }); document.body.replaceChildren(); vi.mocked(api).mockReset(); });
const twin: AiTwinProfile = { id: "twin", name: "Twin", style: "", paused: false, revision: 2, createdAt: 0, updatedAt: 0 };
const lessons: AiTwinLesson[] = ["First", "Second", "Keep"].map((question) => ({ id: question, question, answer: `${question} answer`, source: "owner", updatedAt: 0 }));
function button(scope: ParentNode, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const changed = vi.fn(), refresh = vi.fn();
  const render = (current = twin) => root.render(createElement(AiTwinLessons, { twin: current, lessons, changed, refresh }));
  await act(async () => render());
  await act(async () => button(host, "Private lessons").click());
  await act(async () => button(host, "Select lessons to forget").click());
  const checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  await act(async () => { checkboxes[0]!.click(); checkboxes[1]!.click(); });
  await act(async () => button(host, "Forget selected lessons").click());
  return { host, root, changed, refresh, render };
}

it("shows exactly what will be forgotten and only sends after confirmation", async () => {
  const { changed } = await mount();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("First"); expect(dialog.textContent).toContain("Second"); expect(dialog.textContent).not.toContain("Keep");
  expect(dialog.textContent).toContain("previous replies");
  expect(vi.mocked(api)).not.toHaveBeenCalled();
  const view = { twin: { ...twin, revision: 3 }, creationEpoch: "initial", lessons: [lessons[2]] };
  vi.mocked(api).mockResolvedValueOnce(view);
  await act(async () => button(dialog, "Forget selected lessons").click());
  expect(vi.mocked(api)).toHaveBeenCalledWith(AI_TWIN_FORGET_MANY_PATH, expect.objectContaining({ method: "DELETE" }));
  expect(JSON.parse(String(vi.mocked(api).mock.calls[0]![1]?.body))).toEqual({ id: twin.id, revision: 2, lessonIds: ["First", "Second"], confirmForget: true });
  expect(changed).toHaveBeenCalledWith(view);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("uses the reviewed revision and asks for refresh if the Twin changed", async () => {
  const { refresh, render } = await mount();
  await act(async () => render({ ...twin, revision: 3 }));
  vi.mocked(api).mockRejectedValueOnce(new ApiError("twin_changed", 409, { error: "twin_changed" }));
  await act(async () => button(document.querySelector('[role="alertdialog"]')!, "Forget selected lessons").click());
  expect(JSON.parse(String(vi.mocked(api).mock.calls[0]![1]?.body)).revision).toBe(2);
  expect(refresh).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
