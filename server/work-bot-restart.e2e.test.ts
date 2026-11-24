import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it("reopens a pending work-bot choice without dispatching it twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-restart-"));
  const routes = join(dir, "routes.json");
  const prompts = join(dir, "prompts.jsonl");
  const text = "Monitor synthetic inventory weekly";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Inventory", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url");
  const env = { ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  let restarted: ChildProcess | undefined;
  try {
    fixture = await launchVerificationServer(env);
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value as T;
    };
    const main = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.defaultBot)!;
    const rows = async () => (await api<{ messages: Message[] }>(`/api/threads/${main.threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).find(row => row.text === text)?.workBotRouting?.state, { timeout: 20000 }).toBe("waiting_choice");
    fixture.child.kill("SIGTERM");
    await new Promise<void>(resolve => fixture.child.once("exit", () => resolve()));
    const port = Number(new URL(base).port);
    const childEnv = verificationServerEnvironment(env, fixture.info.dataDir, port);
    restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => {
      try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
    }, { timeout: 30000 }).toBe(true);
    await expect.poll(async () => (await rows()).find(row => row.text === text)?.workBotRouting?.state, { timeout: 20000 }).toBe("waiting_choice");
    const card = (await rows()).find(row => row.card?.teamSetupRequest?.workBotOffer)?.card;
    expect(card?.requestId).toBeTruthy();
    const accepted = await api<{ result: { bots: Array<{ id: string }> } }>(`/api/threads/${main.threadId}/respond`, { requestId: card!.requestId, behavior: "allow" });
    const bot = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(row => row.id === accepted.result.bots[0]?.id)!;
    await expect.poll(async () => {
      const messages = (await api<{ messages: Message[] }>(`/api/threads/${bot.threadId}/messages`)).messages;
      const index = messages.findIndex(row => row.role === "user" && row.text === text);
      return index >= 0 && messages.slice(index + 1).some(row => row.role === "bot" && row.kind === "text");
    }, { timeout: 20000 }).toBe(true);
    expect(readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(text))).toHaveLength(1);
  } finally {
    if (restarted && restarted.exitCode === null) {
      restarted.kill("SIGTERM");
      await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
    }
    await fixture?.close();
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
