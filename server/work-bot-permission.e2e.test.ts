import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each([
  { initial: "ask", selected: "ask", decision: "deny", count: 0 },
  { initial: "ask", selected: "ask", decision: "allow", count: 1 },
  { initial: "full", selected: "full", decision: "full", count: 1 },
  { initial: "full", selected: "ask", decision: "deny", count: 0 },
  { initial: "full", selected: "ask", decision: "deny", count: 0, threadOnly: true },
] as const)("keeps $selected permissions for a handoff ($initial to $decision)", async (scenario) => {
  const { initial, selected, decision, count } = scenario;
  const dir = mkdtempSync(join(tmpdir(), "work-bot-permission-"));
  const routes = join(dir, "routes.json"), counter = join(dir, "counter");
  const text = "Theo dõi đơn hàng hằng tuần";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Đơn hàng", icon: "tasks" }) }));
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
    await api(`/api/bots/${main.id}`, { approvalMode: initial, applyToAllThreads: true }, "PATCH");
    const rows = async (threadId: string) => (await api<{ messages: Message[] }>(`/api/threads/${threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const offer = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const targetId = offer.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId;
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [targetId]: { script: [{ key: "permission", match: [text], approve: { tool_name: "Bash", input: { command: "synthetic-permission-write" } }, fixturePermissionCounter: counter, reply: "Synthetic done.", replyIfDenied: "Synthetic denied." }] } }));
    if (initial !== selected) {
      if ("threadOnly" in scenario) await api(`/api/bots/${main.id}/tasks/${main.threadId}`, { approvalMode: selected }, "PATCH");
      else await api(`/api/bots/${main.id}`, { approvalMode: selected, applyToAllThreads: true }, "PATCH");
    }
    await api(`/api/threads/${main.threadId}/respond`, { requestId: offer.requestId, behavior: "allow" });
    const target = (await bots()).find(bot => bot.id === targetId)!;
    expect(target.approvalMode).toBe(selected);
    if (selected === "ask") {
      await expect.poll(async () => (await rows(target.threadId)).some(row => row.card?.tool === "Bash" && !row.card.answered), { timeout: 30000 }).toBe(true);
      expect(existsSync(counter)).toBe(false);
      const approval = (await rows(target.threadId)).find(row => row.card?.tool === "Bash" && !row.card.answered)!.card!;
      await api(`/api/threads/${target.threadId}/respond`, { requestId: approval.requestId, behavior: decision });
    }
    await expect.poll(async () => (await rows(target.threadId)).some(row => row.text === (decision === "deny" ? "Synthetic denied." : "Synthetic done.")), { timeout: 30000 }).toBe(true);
    expect(existsSync(counter) ? readFileSync(counter, "utf8").trim().split("\n").length : 0).toBe(count);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
