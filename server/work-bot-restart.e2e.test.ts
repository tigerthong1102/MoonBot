import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    const originalChild = fixture.child;
    originalChild.kill("SIGTERM");
    await new Promise<void>(resolve => originalChild.once("exit", () => resolve()));
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
    await expect.poll(async () => (await api<{ messages: Message[] }>(`/api/threads/${bot.threadId}/messages`)).messages.find(row => row.text === text)?.workBotRecoveryPending, { timeout: 20000 }).toBeUndefined();
    expect(readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(text))).toHaveLength(1);
    restarted.kill("SIGTERM");
    await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
    const database = new DatabaseSync(join(fixture.info.dataDir, "messages.db"));
    const target = (await rowsBeforeShutdown(database, bot.threadId)).find(row => row.text === text)!;
    database.prepare("UPDATE messages SET json = json_set(json, '$.requestPending', json('true')) WHERE thread_id = ? AND id = ?").run(bot.threadId, target.id);
    database.close();
    restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => {
      try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
    }, { timeout: 30000 }).toBe(true);
    await expect.poll(async () => (await rows()).find(row => row.text === text)?.workBotRouting?.state, { timeout: 20000 }).toBe("interrupted");
    const targetRows = async () => (await api<{ messages: Message[] }>(`/api/threads/${bot.threadId}/messages`)).messages;
    expect((await targetRows()).find(row => row.id === target.id)?.workBotExecutionUncertain).toBe(true);
    const next = "Show the synthetic status without repeating work";
    await api(`/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: next, sendId: randomUUID() });
    await expect.poll(async () => (await targetRows()).some(row => row.role === "bot" && row.at > target.at), { timeout: 20000 }).toBe(true);
    await expect.poll(() => readFileSync(prompts, "utf8").split("\n").some(line => line.includes(next)), { timeout: 20000 }).toBe(true);
    const nextPrompt = readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).find(prompt => JSON.stringify(prompt).includes(next));
    expect(JSON.stringify(nextPrompt)).not.toContain(text);
    expect(JSON.stringify(nextPrompt)).toContain("Do not repeat it automatically");
    await expect.poll(async () => (await targetRows()).find(row => row.text === next)?.requestPending, { timeout: 20000 }).toBe(false);
    restarted.kill("SIGTERM");
    await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
    const orphanDb = new DatabaseSync(join(fixture.info.dataDir, "messages.db"));
    orphanDb.prepare("DELETE FROM messages WHERE thread_id = ? AND id = ?").run(main.threadId, target.workBotHandoffSource!.messageId);
    orphanDb.prepare("UPDATE messages SET json = json_remove(json_set(json, '$.requestPending', json('true')), '$.workBotExecutionUncertain') WHERE thread_id = ? AND id = ?").run(bot.threadId, target.id);
    orphanDb.close();
    restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => {
      try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
    }, { timeout: 30000 }).toBe(true);
    expect((await targetRows()).find(row => row.id === target.id)?.workBotExecutionUncertain).toBe(true);
    expect((await targetRows()).find(row => row.id === target.id)?.requestPending).toBe(false);
    const orphanFollowUp = "Show status after the source was removed";
    await api(`/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: orphanFollowUp, sendId: randomUUID() });
    await expect.poll(async () => (await targetRows()).find(row => row.text === orphanFollowUp)?.requestPending, { timeout: 20000 }).toBe(false);
    const orphanPrompt = readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).find(prompt => JSON.stringify(prompt).includes(orphanFollowUp));
    expect(JSON.stringify(orphanPrompt)).not.toContain(text);
    expect(readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(text))).toHaveLength(1);
    restarted.kill("SIGTERM");
    await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
    const savedTask = () => (JSON.parse(readFileSync(join(fixture!.info.dataDir, "bots.json"), "utf8")) as BotRecord[]).find(row => row.id === bot.id)!.tasks!.find(task => task.threadId === bot.threadId)!;
    const cursor = structuredClone(savedTask().resumeCursors);
    restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => {
      try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
    }, { timeout: 30000 }).toBe(true);
    expect(savedTask().resumeCursors).toEqual(cursor);
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

function rowsBeforeShutdown(database: DatabaseSync, threadId: string): Message[] {
  return (database.prepare("SELECT json FROM messages WHERE thread_id = ?").all(threadId) as Array<{ json: string }>).map(row => JSON.parse(row.json) as Message);
}
