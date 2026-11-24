// @vitest-environment happy-dom
import { createElement, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, BotAnnouncement, Message } from "./store";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

const allowKey = "provider-tool:claude:linear:list_issues:0123456789abcdef";
const approval: Message = {
  id: "approval", role: "bot", kind: "options", at: 1,
  card: { title: "Approval needed", subtitle: "list issues", options: ["Allow", "Deny"], requestId: "request-1", allowKey },
};
const bot: BotAnnouncement = {
  id: "bot", threadId: "thread", name: "Fixture", title: "", description: "",
  notifications: true, unread: false, color: "green",
  modelSelection: { instanceId: "fake", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1 }],
  messages: [approval],
};

let saveGrant: () => Promise<Response>;
let decision: () => Promise<Response> = () => json({ ok: true });
let botRead: () => Promise<Response> = () => json({});
const writes: string[] = [];
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const { StoreProvider, useStore } = await import("./store");

let seen!: AppState;
let dispatch!: Dispatch<Action>;
function Probe() {
  ({ state: seen, dispatch } = useStore());
  return null;
}
let root: Root;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeAll(async () => {
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, options?: RequestInit) => {
    if (options?.method && options.method !== "GET") writes.push(path);
    if (path.startsWith("/api/bots?")) return json({ bots: [bot], groups: [] });
    if (path === "/api/bots/bot/always-allow") return saveGrant();
    if (path.endsWith("/respond")) return decision();
    if (path.startsWith("/api/bots/new-bot?")) return botRead();
    return json({});
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
  FixtureEventSource.opened[0].send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
});
beforeEach(() => {
  writes.length = 0;
  decision = () => json({ ok: true });
  botRead = () => json({});
  flushSync(() => dispatch({ type: "error", message: null }));
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
});

const alwaysAllow = (onError?: (message: string) => void) => flushSync(() => dispatch({
  type: "decideRequest", threadId: "thread", requestId: "request-1", behavior: "allow",
  alwaysAllow: { botId: "bot", key: allowKey }, onError,
}));

describe("Always allow on an approval card", () => {
  it("saves the grant and then approves the request", async () => {
    let finishSave!: (response: Response) => void;
    saveGrant = () => new Promise((resolve) => { finishSave = resolve; });
    alwaysAllow();
    await settle();
    expect(writes).toEqual(["/api/bots/bot/always-allow"]);
    finishSave(new Response(JSON.stringify({ bot }), { status: 200 }));
    await settle();
    expect(writes).toEqual(["/api/bots/bot/always-allow", "/api/threads/thread/respond"]);
    expect(seen.error).toBeNull();
  });

  it("leaves the request waiting when the grant could not be saved", async () => {
    saveGrant = () => json({ error: "This bot already always-allows 200 tools." }, 400);
    const onError = vi.fn();
    alwaysAllow(onError);
    await settle();
    expect(writes).toEqual(["/api/bots/bot/always-allow"]);
    expect(seen.error).toContain("200 tools");
    expect(onError).toHaveBeenCalledOnce();
  });
});


describe("opening a newly created work bot", () => {
  it("does not open a bot when its transcript snapshot is missing", async () => {
    decision = () => json({ routingState: "dispatched", result: { state: "applied", bots: [{ id: "new-bot", action: "created" }] } });
    botRead = () => json({ bot: { ...bot, id: "new-bot", threadId: "new-thread", messages: undefined } });
    const onError = vi.fn();
    flushSync(() => dispatch({ type: "select", id: "bot" }));
    flushSync(() => dispatch({ type: "decideRequest", threadId: "thread", requestId: "work-request", behavior: "allow", openCreatedBot: true, onError }));
    await settle();
    expect(seen.selectedId).toBe("bot");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not change conversations after the user navigates while the bot loads", async () => {
    let release!: (response: Response) => void;
    decision = () => json({ routingState: "dispatched", result: { state: "applied", bots: [{ id: "new-bot", action: "created" }] } });
    botRead = () => new Promise(resolve => { release = resolve; });
    flushSync(() => dispatch({ type: "decideRequest", threadId: "thread", requestId: "work-request", behavior: "allow", openCreatedBot: true }));
    await settle();
    flushSync(() => dispatch({ type: "select", id: "bot" }));
    const created = { ...bot, id: "new-bot", threadId: "new-thread", tasks: [{ threadId: "new-thread", title: "Thread", createdAt: 1 }], messages: [] };
    release(new Response(JSON.stringify({ bot: created }), { status: 200 }));
    await settle();
    expect(seen.selectedId).toBe("bot");
  });

  it("waits for the bot to be readable before selecting it", async () => {
    let release!: (response: Response) => void;
    decision = () => json({ routingState: "dispatched", result: { state: "applied", bots: [{ id: "new-bot", action: "created" }] } });
    botRead = () => new Promise(resolve => { release = resolve; });
    flushSync(() => dispatch({ type: "decideRequest", threadId: "thread", requestId: "work-request", behavior: "allow", openCreatedBot: true }));
    await settle();
    expect(seen.selectedId).not.toBe("new-bot");
    const created = { ...bot, id: "new-bot", threadId: "new-thread", tasks: [{ threadId: "new-thread", title: "Thread", createdAt: 1 }], messages: [] };
    release(new Response(JSON.stringify({ bot: created }), { status: 200 }));
    await settle();
    expect(seen.selectedId).toBe("new-bot");
    expect(seen.bots.some(candidate => candidate.id === "new-bot")).toBe(true);
  });
});
