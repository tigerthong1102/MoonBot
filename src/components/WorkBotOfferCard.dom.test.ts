// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { OptionCardData } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const dispatched = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: [] }, dispatch: dispatched }) }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/cloud-guest", () => ({ useCloudGuest: () => false }));

it("shows a clear keyboard-operable continue-here choice when files cannot be transferred", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("vi");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const { WorkBotOfferCard } = await import("./WorkBotOfferCard");
  const card = { title: "Tạo bot?", options: ["Tạo bot và giao việc", "Cancel"], requestId: "request", teamSetupRequest: { workBotOffer: { icon: "box", topic: "Việc thử", contextBlock: "files" } } } as OptionCardData;
  try {
    await act(async () => root.render(createElement(WorkBotOfferCard, { card, threadId: "thread" })));
    expect(container.textContent).toContain("Chưa thể chuyển an toàn tệp");
    expect(container.textContent).not.toContain("Tạo bot và giao việc");
    const button = [...container.querySelectorAll("button")].find(element => element.textContent === "Tiếp tục tại đây")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    expect(dispatched).toHaveBeenCalledExactlyOnceWith({ type: "decideRequest", threadId: "thread", requestId: "request", behavior: "deny", openCreatedBot: false });
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
