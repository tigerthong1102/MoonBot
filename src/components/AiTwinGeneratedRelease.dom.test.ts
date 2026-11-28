// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AiTwinGeneratedRelease } from "./AiTwinGeneratedRelease";

it("permits eight explicit rooms and lets the reviewer change the selection", async () => {
  const rooms = Array.from({ length: 9 }, (_, index) => ({
    id: String(index), ref: "room-" + index, title: "Room " + index, kind: "direct",
  }));
  const provider = { key: "fixture", name: "Fixture", model: "Model", destination: "https://provider.example" };
  const generatedChoices = vi.fn(async () => ({ rooms, provider }));
  const offerGenerated = vi.fn(async () => false);
  vi.stubGlobal("ogb", { personalInbox: { generatedChoices, offerGenerated, generatedStatus: vi.fn(), stopGenerated: vi.fn() } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AiTwinGeneratedRelease, { paired: true })));
    await act(async () => host.querySelector("button")!.click());
    const scope = host.querySelector<HTMLSelectElement>("select")!;
    expect([...scope.labels].map(label => label.textContent)).toEqual(["Room scope"]);
    scope.focus();
    expect(document.activeElement).toBe(scope);
    const choices = Array.from(host.querySelectorAll<HTMLInputElement>("input"));
    expect(choices).toHaveLength(9);
    for (const box of choices.slice(0, 8)) await act(async () => box.click());
    expect(choices[8]!.disabled).toBe(true);
    expect(choices[0]!.disabled).toBe(false);
    await act(async () => choices[0]!.click());
    expect(choices[8]!.disabled).toBe(false);
    await act(async () => choices[8]!.click());
    const offer = host.querySelectorAll("button")[1]!;
    await act(async () => offer.click());
    expect(offerGenerated).toHaveBeenCalledWith(provider, rooms.slice(1).map(room => room.ref));
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
