import { describe, expect, it, vi } from "vitest";
import type { Message } from "./store.ts";
import { WorkBotRouter, type WorkBotRoutingDependencies } from "./work-bot-routing.ts";

function fixture() {
  let message: Message = { id: "source", at: 1, role: "user", kind: "text", text: "Follow inventory", workBotRouting: { state: "classifying" } };
  const dispatch = vi.fn(async () => {});
  const offer = vi.fn(async (): Promise<{ requestId: string } | null> => ({ requestId: "offer" }));
  const deps: WorkBotRoutingDependencies = {
    message: () => message,
    patch: (_thread, _id, expected, routing) => {
      if (message.workBotRouting?.state !== expected) return false;
      message = { ...message, workBotRouting: routing };
      return true;
    },
    offer,
    mainTarget: () => ({ botId: "main", threadId: "main-thread" }),
    decision: async () => ({ state: "pending" }),
    dispatch,
    report: vi.fn(),
  };
  return { router: new WorkBotRouter(deps), deps, dispatch, offer, message: () => message };
}

describe("work bot request routing", () => {
  it("holds a qualifying request until the person chooses and dispatches once", async () => {
    const f = fixture();
    await f.router.classify("main-thread", "source");
    expect(f.message().workBotRouting).toEqual({ state: "waiting_choice", requestId: "offer" });
    expect(f.dispatch).not.toHaveBeenCalled();
    const target = { botId: "worker", threadId: "worker-thread" };
    expect(await Promise.all([f.router.choose("main-thread", "source", "offer", target), f.router.choose("main-thread", "source", "offer", target)])).toEqual(["accepted", "not_claimed"]);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.message().workBotRouting).toMatchObject({ state: "dispatched", targetBotId: "worker", targetThreadId: "worker-thread" });
  });

  it("uses the main bot once if classification fails or finds no offer", async () => {
    for (const offline of [false, true]) {
      const f = fixture();
      if (offline) f.offer.mockRejectedValueOnce(new Error("offline"));
      else f.offer.mockResolvedValueOnce(null);
      await Promise.all([f.router.classify("main-thread", "source"), f.router.classify("main-thread", "source")]);
      expect(f.dispatch).toHaveBeenCalledTimes(1);
      expect(f.dispatch).toHaveBeenCalledWith("main-thread", "source", { botId: "main", threadId: "main-thread" });
    }
  });

  it("does not dispatch after cancellation while the classifier is running", async () => {
    const f = fixture();
    let finish!: (offer: { requestId: string }) => void;
    f.offer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.router.classify("main-thread", "source");
    expect(f.router.cancel("main-thread", "source")).toBe(true);
    finish({ requestId: "offer" });
    await pending;
    expect(f.message().workBotRouting?.state).toBe("cancelled");
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("reports an uncertain dispatch instead of claiming success", async () => {
    const f = fixture();
    await f.router.classify("main-thread", "source");
    f.dispatch.mockRejectedValueOnce(new Error("connection dropped"));
    expect(await f.router.choose("main-thread", "source", "offer", { botId: "worker", threadId: "worker-thread" })).toBe("interrupted");
    expect(f.message().workBotRouting?.state).toBe("interrupted");
    expect(await f.router.choose("main-thread", "source", "offer", { botId: "worker", threadId: "worker-thread" })).toBe("not_claimed");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it("times out a stalled classifier and dispatches to the main bot once", async () => {
    const f = fixture();
    f.offer.mockImplementationOnce(() => new Promise(() => {}));
    const router = new WorkBotRouter(f.deps, 5);
    await router.classify("main-thread", "source");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.message().workBotRouting?.state).toBe("dispatched");
  });

  it("does not report acceptance when recovery interrupted an in-flight dispatch", async () => {
    const f = fixture();
    await f.router.classify("main-thread", "source");
    let finish!: () => void;
    f.dispatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.router.choose("main-thread", "source", "offer", { botId: "worker", threadId: "worker-thread" });
    await f.router.recover("main-thread", "source");
    finish();
    expect(await pending).toBe("interrupted");
    expect(f.message().workBotRouting?.state).toBe("interrupted");
  });

  it("reconciles a previously chosen destination during recovery", async () => {
    const f = fixture();
    await f.router.classify("main-thread", "source");
    f.deps.decision = async () => ({ state: "chosen", target: { botId: "worker", threadId: "worker-thread" } });
    await f.router.recover("main-thread", "source");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.message().workBotRouting?.state).toBe("dispatched");
  });

  it("marks an uncertain dispatch interrupted after restart instead of repeating it", async () => {
    const f = fixture();
    f.deps.patch("main-thread", "source", "classifying", { state: "dispatching", targetBotId: "worker", targetThreadId: "worker-thread" });
    await f.router.recover("main-thread", "source");
    expect(f.message().workBotRouting).toMatchObject({ state: "interrupted", targetBotId: "worker" });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
});
