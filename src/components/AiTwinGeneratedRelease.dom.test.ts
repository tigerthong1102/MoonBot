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
  vi.stubGlobal("ogb", { personalInbox: { generatedChoices, offerGenerated, generatedStatus: vi.fn(async () => ({ available:true, remote:null })), stopGenerated: vi.fn() } });
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

it("requires a separate while-open choice and a valid rolling daily limit", async () => {
  const provider = { key: "fixture", name: "Fixture", model: "Model", destination: "https://provider.example" };
  const rooms = [{ ref: "room-ref", id: "room", title: "Conversation", kind: "direct" }];
  const offerGenerated = vi.fn(async () => false);
  vi.stubGlobal("ogb", { personalInbox: {
    generatedChoices: async () => ({ provider, rooms }), offerGenerated, generatedStatus: vi.fn(async () => ({ available:true, remote:null })), stopGenerated: vi.fn(),
  } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AiTwinGeneratedRelease, { paired: true })));
    await act(async () => host.querySelector("button")!.click());
    const duration = host.querySelector<HTMLSelectElement>("[data-duration]")!;
    const submit = host.querySelectorAll("button")[1]!;
    expect(duration.value).toBe("once");
    expect(host.querySelector("input[type=number]")).toBeNull();
    await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await act(async () => {
      duration.value = "online";
      duration.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const input = host.querySelector<HTMLInputElement>("input[type=number]")!;
    expect(input.value).toBe("5");
    expect(host.textContent).toContain("automatically renews permission");
    async function edit(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await edit("721");
    expect(submit.disabled).toBe(true);
    await edit("12");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(offerGenerated).toHaveBeenCalledWith(provider, ["room-ref"], 12);
    expect(host.textContent).toContain("12 per rolling 24 hours");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});


it("shows Stop and withholds changes while an existing grant is active", async () => {
  const choices = vi.fn();
  const stop = vi.fn(async () => ({ available:true, owner:"owner", remote:null }));
  vi.stubGlobal("ogb", {personalInbox:{generatedChoices:choices, offerGenerated:vi.fn(), stopGenerated:stop,
    generatedStatus:async()=>({available:true,owner:"owner",remote:{id:"grant",enabled:true,count:1,expires:Date.now()+60000}})}});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async()=>root.render(createElement(AiTwinGeneratedRelease,{paired:true})));
    await act(async()=>host.querySelector("button")!.click());
    expect(choices).not.toHaveBeenCalled();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).toContain("Stop this permission before changing");
    const button = [...host.querySelectorAll("button")].find(node=>node.textContent?.includes("Stop"))!;
    await act(async()=>button.click());
    expect(stop).toHaveBeenCalledWith({id:"grant",owner:"owner"});
    expect(host.textContent).toContain("no active or pending permission");
  } finally {
    await act(async()=>root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
