// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadLocale, setLocale } from "@/lib/i18n";
import hyperframes from "../../skills/catalog/hyperframes/SKILL.md?raw";
import { SkillInstructions } from "./SkillInstructions";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
  vi.unstubAllGlobals();
});

it.each([
  ["vi", "Quy tắc"],
  ["zh", "规则"],
  ["zh-tw", "規則"],
])("shows the current HyperFrames guide in %s", async (locale, heading) => {
  await loadLocale(locale);
  await act(async () => {
    root.render(createElement(SkillInstructions, { name: "hyperframes", text: hyperframes, label: "skill" }));
  });
  await vi.waitFor(() => expect(host.querySelector("pre")?.textContent).toContain(heading));
  expect(host.querySelector("pre")?.textContent).toContain("data-duration");
  expect(host.querySelector("pre")?.getAttribute("lang")).toBe(locale);
});

it("does not show a bundled translation for edited instructions", async () => {
  await loadLocale("vi");
  await act(async () => {
    root.render(createElement(SkillInstructions, { name: "hyperframes", text: `${hyperframes}\nUser edit`, label: "skill" }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.querySelector("pre")?.textContent).toContain("User edit");
  expect(host.querySelector("pre")?.getAttribute("lang")).toBeNull();
});
