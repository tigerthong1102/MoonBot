import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), listen: vi.fn(), runEffect: false }));
vi.mock("@/state/store", () => ({ api: fixture.api }));
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: fixture.listen }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useEffect: (run: () => void) => { if (fixture.runEffect) run(); }, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));

import { appTriggerApi, applyAppTriggerFrame, loadAppTriggers, useAppTriggers } from "./app-triggers";

const snapshot = (issue?: "changed") => ({ triggers: [], attempts: [], service: { available: true, ...(issue ? { cursorReview: issue } : {}) } });
const changed = { kind: "app-trigger.service" as const, service: { available: true, cursorReview: "changed" as const } };

describe("app event snapshot synchronization", () => {
  beforeEach(() => fixture.api.mockReset());

  it("replays live frames received while a snapshot is in flight", async () => {
    let finish!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const load = loadAppTriggers();
    applyAppTriggerFrame(changed);
    finish(snapshot());
    await load;
    expect(useAppTriggers().service?.cursorReview).toBe("changed");
  });

  it("synchronizes again after a delayed frame and reports GET failures", async () => {
    vi.useFakeTimers();
    fixture.api.mockResolvedValueOnce(snapshot());
    fixture.runEffect = true;
    useAppTriggers();
    fixture.runEffect = false;
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.api).toHaveBeenCalledTimes(1);
    applyAppTriggerFrame(changed);
    fixture.api.mockResolvedValueOnce(snapshot());
    await vi.advanceTimersByTimeAsync(500);
    expect(useAppTriggers().service?.cursorReview).toBeUndefined();
    fixture.api.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error("offline"));
    await expect(appTriggerApi.sync()).rejects.toThrow("offline");
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("takes a new snapshot after sync even when an earlier GET is pending", async () => {
    let finish!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot("changed"));
    const load = loadAppTriggers();
    const sync = appTriggerApi.sync();
    await Promise.resolve();
    finish(snapshot());
    await Promise.all([load, sync]);
    expect(fixture.api).toHaveBeenCalledTimes(3);
    expect(useAppTriggers().service?.cursorReview).toBe("changed");
  });

  it("refreshes after a live frame even when the debounce expires during a slow request", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(snapshot());
    const load = loadAppTriggers();
    applyAppTriggerFrame(changed);
    await vi.advanceTimersByTimeAsync(500);
    finish(snapshot());
    await load;
    expect(useAppTriggers().service?.cursorReview).toBe("changed");
    await vi.advanceTimersByTimeAsync(500);
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(useAppTriggers().service?.cursorReview).toBeUndefined();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("retries a failed background refresh without losing the live warning", async () => {
    vi.useFakeTimers();
    fixture.api.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(snapshot("changed"));
    applyAppTriggerFrame(changed);
    await vi.advanceTimersByTimeAsync(500);
    expect(useAppTriggers().service?.cursorReview).toBe("changed");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(useAppTriggers().service?.cursorReview).toBe("changed");
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
