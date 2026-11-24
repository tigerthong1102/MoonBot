import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";
import { waitForExit } from "./testing/cleanup.ts";

it.each(["source", "target"])("rejects the linked meeting schedule over HTTP when %s creates it first", async first => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-meetings-http-"));
  const routes = join(dir, "routes.json"), text = "Follow synthetic meeting notes each week";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Meeting notes", icon: "calendar" }) }));
  const owner = randomBytes(32).toString("base64url"), capabilityKey = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  const ownerFetch: typeof fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": owner } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  let restarted: ChildProcess | undefined;
  const env = { ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, OMB_TEST_DESKTOP_OWNER_TOKEN: owner, OMB_TEST_INTERNAL_CAPABILITY_KEY: capabilityKey };
  try {
    fixture = await launchVerificationServer(env, undefined, undefined, undefined, undefined, { scripted: true });
    const base = fixture.info.url;
    const api = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const response = await ownerFetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { origin: base, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as any };
    };
    const bots = async (): Promise<BotRecord[]> => (await api("/api/bots?messages=0")).body.bots;
    const main = (await bots()).find(bot => bot.defaultBot)!;
    expect((await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() })).status).toBe(202);
    const rows = async (): Promise<Message[]> => (await api(`/api/threads/${main.threadId}/messages`)).body.messages;
    await expect.poll(async () => (await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const card = (await rows()).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const targetId = card.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId;
    expect((await api(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" })).status).toBe(200);
    const target = (await bots()).find(bot => bot.id === targetId)!;
    const mint = async (bot: BotRecord) => {
      const response = await api("/api/testing/internal-capability", { botId: bot.id, threadId: bot.threadId, kind: "agents" }, { "x-openmausbot-test-capability": capabilityKey });
      expect(response.status).toBe(201);
      return response.body.token as string;
    };
    const sourceToken = await mint(main), targetToken = await mint(target);
    const invoke = (token: string) => api("/api/internal/meetings/join", { every_calendar_meeting: true }, { authorization: `Bearer ${token}` });
    const unauthorized = await fetch(base + "/api/internal/meetings/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ every_calendar_meeting: true }) });
    expect([401, 403]).toContain(unauthorized.status);
    const [firstToken, secondToken] = first === "source" ? [sourceToken, targetToken] : [targetToken, sourceToken];
    expect((await invoke(firstToken)).status).toBe(200);
    const denied = await invoke(secondToken);
    expect(denied.status).toBe(409);
    expect(denied.body.error).toContain("may overlap");
    const routines = (await api("/api/routines")).body.routines;
    expect(routines).toHaveLength(1);
    expect(routines[0].botId).toBe(first === "source" ? main.id : target.id);
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const childEnv = verificationServerEnvironment(env, fixture.info.dataDir, Number(new URL(base).port));
    restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => { try { const response = await fetch(base + "/api/health"); const health = await response.json() as { app?: string; pid?: number }; return response.ok && health.app === "openmausbot" && health.pid === restarted?.pid; } catch { return false; } }, { timeout: 30000 }).toBe(true);
    const restored = (await api("/api/routines")).body.routines;
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(routines[0].id);
    expect((await invoke(await mint(first === "source" ? target : main))).status).toBe(409);
    const created = await api("/api/bots", { name: "Independent synthetic bot" });
    expect(created.status).toBe(201);
    const independent = (await bots()).find(bot => bot.name === "Independent synthetic bot")!;
    expect((await invoke(await mint(independent))).status).toBe(200);
    expect((await api("/api/routines")).body.routines).toHaveLength(2);
  } finally {
    if (restarted && restarted.exitCode === null) await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
import { spawn, type ChildProcess } from "node:child_process";
