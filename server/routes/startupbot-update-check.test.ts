import { expect, it, vi } from "vitest";
import { updateRouteDeps } from "./update-check.ts";

it("disables server updates without contacting an upstream feed or offering an updater", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    const deps = updateRouteDeps({ desktopManaged: false, managed: false, dataDir: "/unused", activeTurns: () => 0, actor: () => ({ kind: "loopback" }) });
    expect(await deps.check()).toMatchObject({ available: false, disabled: true });
    expect(deps.server).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
