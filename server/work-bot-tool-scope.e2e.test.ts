import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it("keeps the source tool restriction and blocks the synthetic scheduled action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-scope-"));
  const routes = join(dir, "routes.json"), text = "Theo dõi công việc thử mỗi tuần";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Việc thử", icon: "tasks" }) }));
  const token = randomBytes(32).toString("base64url"), originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, OMB_TEST_DESKTOP_OWNER_TOKEN: token }, undefined, undefined, undefined, undefined, { scripted: true });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown, method = body ? "POST" : "GET"): Promise<T> => {
      const response = await fetch(base + path, { method, headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value as T;
    };
    const bots = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const main = (await bots()).find(bot => bot.defaultBot)!;
    const scope = { deny: ["mcp:agents:create_trigger"] };
    await api(`/api/bots/${main.id}`, { approvalMode: "full", applyToAllThreads: true, toolScope: scope }, "PATCH");
    const rows = async (threadId: string) => (await api<{ messages: Message[] }>(`/api/threads/${threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const card = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const targetId = card.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId;
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [targetId]: { script: [{ key: "scope", match: [text], steps: [{ tool: "create_trigger", expectError: true, arguments: { when: "schedule", name: "Synthetic forbidden action", instructions: "No real data", schedule: { type: "weekly", time: "03:01", weekdays: ["monday"] } } }], reply: "Synthetic blocked action handled." }] } }));
    await api(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    const target = (await bots()).find(bot => bot.id === targetId)!;
    expect(target.approvalMode).toBe("full");
    expect(target.toolScope).toEqual(scope);
    await expect.poll(async () => (await rows(target.threadId)).some(row => row.text === "Synthetic blocked action handled."), { timeout: 30000 }).toBe(true);
    expect((await api<{ routines: unknown[] }>("/api/routines")).routines).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
