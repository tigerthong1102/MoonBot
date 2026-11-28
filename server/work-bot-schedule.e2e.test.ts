import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AI_TWIN_LEARNING_PATH, AI_TWIN_PATH, type AiTwinLearningView, type AiTwinView } from "../shared/ai-twin.ts";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each(["new", "already scheduled"] as const)("runs delegated work once or holds an existing schedule: %s", async scenario => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-schedule-"));
  const routes = join(dir, "routes.json");
  const prompts = join(dir, "prompts.jsonl");
  const text = "Follow the synthetic stock count weekly";
  const sourceQuestion = "Explain the synthetic inventory guide.";
  const helperPrompts = join(dir, "helper-prompts.jsonl");
  writeFileSync(routes, JSON.stringify({
    [sourceQuestion]: JSON.stringify({ paragraphs: [{ text: "Fixture answer", sources: [1] }] }),
    [text]: JSON.stringify({ name: "Stock count", icon: "box" }),
  }));
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_TEXT_LOG: helperPrompts, FAKE_CLAUDE_VERSION: "2.1.321", FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token }, undefined, undefined, undefined, undefined, { scripted: true });
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
    const followUp = "Also include the synthetic warehouse note";
    const queued = await api<{ queued: boolean }>(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: followUp, sendId: randomUUID() });
    expect(queued.queued).toBe(true);
    const targetId = card.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId;
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekday = weekdays[(new Date().getDay() + 3) % 7];
    const plan = join(fixture.info.dataDir, "room-plan.json");
    writeFileSync(plan, JSON.stringify({ [targetId]: { steps: [{ tool: "create_trigger", arguments: { when: "schedule", name: "Synthetic stock fixture", instructions: "Check the synthetic fixture only.", schedule: { type: "weekly", time: "03:01", weekdays: [weekday] } } }], reply: "Synthetic schedule created." } }));
    if (scenario === "already scheduled") {
      await api("/api/routines", { botId: main.id, name: "Existing synthetic stock check", prompt: text, target: "bot", enabled: true,
        schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 }, sameConversation: true });
    }
    const before = (await api<{ routines: unknown[] }>("/api/routines")).routines.length;
    const answer = () => api<{ result: { bots: Array<{ id: string }> } }>(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    const accepted = await answer();
    await answer();
    const worker = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.id === accepted.result.bots[0]?.id)!;
    if (scenario === "already scheduled") {
      const sourceMessageId = card.teamSetupRequest!.workBotOffer!.sourceMessageId;
      expect((await rows(main.threadId)).find(row => row.id === sourceMessageId)?.workBotRouting?.state).toBe("held_for_review");
      const held = (await rows(worker.threadId)).filter(row => row.workBotReviewHold && row.workBotHandoffSource?.messageId === sourceMessageId);
      expect(held.map(row => row.text)).toEqual([text, followUp]);
      expect(held.every(row => row.requestPending === false)).toBe(true);
      expect((await api<{ routines: unknown[] }>("/api/routines")).routines).toHaveLength(before);
      expect(existsSync(plan + ".evidence.jsonl")).toBe(false);
      const workPrompts = existsSync(prompts) ? readFileSync(prompts, "utf8").trim().split("\n").filter(row => row.includes(text)) : [];
      expect(workPrompts).toHaveLength(0);

      const { creationEpoch } = await api<AiTwinView>(AI_TWIN_PATH);
      const { twin } = await api<AiTwinView>(AI_TWIN_PATH, { creationEpoch, creationId: randomUUID(), createConsent: true, name: "Fixture Twin" });
      const enable = await fetch(base + AI_TWIN_LEARNING_PATH, { method: "PATCH", headers: { origin: base, "content-type": "application/json" },
        body: JSON.stringify({ id: twin!.id, revision: twin!.revision, thread: worker.threadId, enabled: true }) });
      expect(enable.status).toBe(200);
      const learned = await api<AiTwinLearningView>(AI_TWIN_LEARNING_PATH);
      expect(learned.examples.map(example => example.text)).not.toContain(text);
      expect(learned.examples.map(example => example.text)).not.toContain(followUp);

      await api(`/api/bots/${worker.id}/knowledge-answers`, { threadId: worker.threadId, sendId: randomUUID(), question: sourceQuestion,
        evidence: [{ path: "guide.txt", digest: "a".repeat(64), start: 0, page: 1, paragraph: 1, text: "Count inventory." }] });
      const calls = readFileSync(helperPrompts, "utf8").trim().split("\n").filter(line => line.includes(sourceQuestion));
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("held for review");
      expect(calls[0]).not.toContain(text);
      expect(calls[0]).not.toContain(followUp);
      return;
    }
    await expect.poll(async () => (await rows(worker.threadId)).some(row => row.role === "bot" && row.text === "Synthetic schedule created."), { timeout: 30000 }).toBe(true);
    expect((await rows(worker.threadId)).some(row => row.role === "user" && row.text === followUp)).toBe(true);
    const routines = (await api<{ routines: Array<{ name: string; botId: string; sourceThreadId: string }> }>("/api/routines")).routines;
    expect(routines).toHaveLength(before + 1);
    expect(routines.filter(routine => routine.name === "Synthetic stock fixture")).toMatchObject([{ botId: worker.id, sourceThreadId: worker.threadId }]);
    expect((await rows(main.threadId)).some(row => row.card?.routineRequest)).toBe(false);
    const evidence = readFileSync(plan + ".evidence.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line) as { botId: string; evidence: Array<{ step?: { tool?: string }; response?: unknown }> });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].botId).toBe(worker.id);
    expect(readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(text))).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
