import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it("creates one synthetic schedule only in the approved work bot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-schedule-"));
  const routes = join(dir, "routes.json");
  const prompts = join(dir, "prompts.jsonl");
  const text = "Follow the synthetic stock count weekly";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Stock count", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token }, undefined, undefined, undefined, undefined, { scripted: true });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value as T;
    };
    const main = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.defaultBot)!;
    const rows = async (threadId: string) => (await api<{ messages: Message[] }>(`/api/threads/${threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const card = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const source = (await rows(main.threadId)).find(row => row.text === text)!;
    const followUp = "Thanks, keep this note in the main chat";
    const queued = await api<{ queued: boolean }>(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: followUp, replyToId: source.id, dataContext: { cardId: "c_42" }, sendId: randomUUID() });
    expect(queued.queued).toBe(true);
    const targetId = card.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId;
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekday = weekdays[(new Date().getDay() + 3) % 7];
    const plan = join(fixture.info.dataDir, "room-plan.json");
    writeFileSync(plan, JSON.stringify({ [targetId]: { steps: [{ tool: "create_trigger", arguments: { when: "schedule", name: "Synthetic stock fixture", instructions: "Check the synthetic fixture only.", schedule: { type: "weekly", time: "03:01", weekdays: [weekday] } } }], reply: "Synthetic schedule created." }, [main.id]: { script: [{ key: "follow-up", match: [followUp], steps: [{ tool: "session_search", arguments: { query: "synthetic stock count" } }, { tool: "session_read", arguments: { thread_id: main.threadId, message_id: source.id } }], reply: "Synthetic follow-up complete." }] } }));
    const before = (await api<{ routines: unknown[] }>("/api/routines")).routines.length;
    const answer = () => api<{ result: { bots: Array<{ id: string }> } }>(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    const accepted = await answer();
    await answer();
    const worker = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.id === accepted.result.bots[0]?.id)!;
    await expect.poll(async () => (await rows(worker.threadId)).some(row => row.role === "bot" && row.text === "Synthetic schedule created."), { timeout: 30000 }).toBe(true);
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.role === "bot" && row.text === "Synthetic follow-up complete."), { timeout: 30000 }).toBe(true);
    const routines = (await api<{ routines: Array<{ name: string; botId: string; sourceThreadId: string }> }>("/api/routines")).routines;
    expect(routines).toHaveLength(before + 1);
    expect(routines.filter(routine => routine.name === "Synthetic stock fixture")).toMatchObject([{ botId: worker.id, sourceThreadId: worker.threadId }]);
    expect((await rows(main.threadId)).some(row => row.card?.routineRequest)).toBe(false);
    const evidence = readFileSync(plan + ".evidence.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line) as { botId: string; evidence: Array<{ step?: { tool?: string }; response?: unknown }> });
    expect(evidence).toHaveLength(2);
    const mainTools = evidence.find(turn => turn.botId === main.id)!.evidence;
    for (const tool of ["session_search", "session_read"]) {
      const response = JSON.stringify(mainTools.find(entry => entry.step?.tool === tool)?.response);
      expect(response).toContain("assigned to another bot");
      expect(response).not.toContain(text);
    }
    expect(readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(text))).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
