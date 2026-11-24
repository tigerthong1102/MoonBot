import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each([true, false])("does not repeat a synthetic schedule after a crash (dedicated bot: %s)", async dedicated => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-crash-"));
  const routes = join(dir, "routes.json"), prompts = join(dir, "prompts.jsonl");
  const ready = join(dir, "ready"), gate = join(dir, "gate");
  const text = "Track the synthetic inventory every week";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Inventory", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url");
  const env = { ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  let restarted: ChildProcess | undefined;
  try {
    fixture = await launchVerificationServer(env, undefined, undefined, undefined, undefined, { scripted: true });
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
    const targetId = dedicated ? card.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId : main.id;
    const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][(new Date().getDay() + 3) % 7];
    const plan = join(fixture.info.dataDir, "room-plan.json");
    writeFileSync(plan, JSON.stringify({ [targetId]: { script: [
      { key: "original", match: [text], repeat: true, steps: [{ tool: "create_trigger", arguments: { when: "schedule", name: "Crash fixture schedule", instructions: "Synthetic data only.", schedule: { type: "weekly", time: "03:01", weekdays: [weekday] } } }], readyFile: ready, gateFile: gate, reply: "Created." },
      { key: "followup", match: ["Show status"], reply: "Status checked." },
    ] } }));
    const before = (await api<{ routines: unknown[] }>("/api/routines")).routines.length;
    await api(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: dedicated ? "allow" : "deny" });
    const bot = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(row => row.id === targetId)!;
    await expect.poll(() => existsSync(ready), { timeout: 30000 }).toBe(true);
    const created = (await api<{ routines: Array<{ id: string; name: string; botId: string; sourceThreadId: string }> }>("/api/routines")).routines;
    expect(created).toHaveLength(before + 1);
    const scheduled = created.find(row => row.name === "Crash fixture schedule")!;
    expect(scheduled).toMatchObject({ botId: bot.id, sourceThreadId: bot.threadId });
    fixture.child.kill("SIGKILL");
    await new Promise<void>(resolve => fixture!.child.once("exit", () => resolve()));
    writeFileSync(gate, "release");
    const childEnv = verificationServerEnvironment(env, fixture.info.dataDir, Number(new URL(base).port));
    restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
    const target = (await rows(bot.threadId)).find(row => row.text === text)!;
    expect(target.workBotExecutionUncertain).toBe(true);
    expect(target.requestPending).toBe(false);
    await api(`/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Show status", sendId: randomUUID() });
    await expect.poll(async () => (await rows(bot.threadId)).some(row => row.role === "bot" && row.text === "Status checked."), { timeout: 20000 }).toBe(true);
    const after = (await api<{ routines: Array<{ id: string; botId: string; sourceThreadId: string }> }>("/api/routines")).routines;
    expect(after).toHaveLength(before + 1);
    expect(after.find(row => row.id === scheduled.id)).toMatchObject({ botId: bot.id, sourceThreadId: bot.threadId });
    const captured = readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown);
    const followup = JSON.stringify(captured.find(prompt => JSON.stringify(prompt).includes("Show status")));
    expect(followup).toContain("Do not repeat it automatically");
    expect(followup).not.toContain(`User: ${text}`);
    expect(followup).toContain("Crash fixture schedule");
  } finally {
    writeFileSync(gate, "release");
    if (restarted && restarted.exitCode === null) {
      restarted.kill("SIGTERM");
      await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
    }
    await fixture?.close();
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
