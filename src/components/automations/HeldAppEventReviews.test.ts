/** @vitest-environment happy-dom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HeldAppEventReviews } from "./HeldAppEventReviews";

it("opens only the selected automation for inspection", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onOpen = vi.fn();
  try {
    await act(() => root.render(createElement(HeldAppEventReviews, { reviews: [{
      key: "fixture", receivedAt: 1, reason: "conflict",
      triggers: [{ id: "original", name: "Existing schedule", botId: "chief" }, { id: "dedicated", name: "Weekly inventory", botId: "inventory-bot" }],
    }], botName: id => id, onOpen })));
    expect(onOpen).not.toHaveBeenCalled();
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    buttons[1]!.click();
    expect(onOpen.mock.calls).toEqual([["dedicated"]]);
  } finally { await act(() => root.unmount()); }
});
