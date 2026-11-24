import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each([{ phase: "before", action: "stop" }, { phase: "after", action: "stop" }, { phase: "before", action: "pause" }, { phase: "after", action: "pause" }, { phase: "after", action: "downgrade" }])("respects $action during a work-bot decision $phase creation", async ({ phase, action }) => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-choice-race-"));
  const routes = join(dir, "routes.json"), marker = join(dir, "marker"), gate = join(dir, "gate");
  const text = "Track the synthetic warehouse each week";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Warehouse", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url");
  const env = { ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, OMB_TEST_DESKTOP_OWNER_TOKEN: token, FAKE_CLAUDE_WORK_BOT_CHOICE_MARKER: marker, FAKE_CLAUDE_WORK_BOT_CHOICE_GATE: gate, FAKE_CLAUDE_WORK_BOT_CHOICE_PHASE: phase };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => previousFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined, child: ChildProcess | undefined;
  try {
    fixture = await launchVerificationServer(env);
    const base = fixture.info.url;
    fixture.child.kill("SIGTERM");
    await new Promise<void>(resolve => fixture!.child.once("exit", () => resolve()));
    const childEnv = verificationServerEnvironment(env, fixture.info.dataDir, Number(new URL(base).port));
    child = spawn(process.execPath, ["--import", pathToFileURL(join(process.cwd(), "server/testing/work-bot-choice-gate.mjs")).href, ...verificationServerArgs(childEnv)], { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
    const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) });
    const bots = async () => (await (await fetch(`${base}/api/bots?messages=0`)).json() as { bots: BotRecord[] }).bots;
    const before = await bots(), main = before.find(bot => bot.defaultBot)!;
    if (action === "downgrade") {
      const response = await fetch(`${base}/api/bots/${main.id}`, { method: "PATCH", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ approvalMode: "full", applyToAllThreads: true }) });
      expect(response.ok).toBe(true);
    }
    const rows = async (threadId: string) => (await (await fetch(`${base}/api/threads/${threadId}/messages`)).json() as { messages: Message[] }).messages;
    expect((await post(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() })).ok).toBe(true);
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const card = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const decision = post(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    await expect.poll(() => existsSync(marker), { timeout: 20000 }).toBe(true);
    if (action === "stop") {
      expect((await post(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: "stop", sendId: randomUUID() })).status).toBe(409);
      expect((await post(`/api/bots/${main.id}/interrupt`, { threadId: main.threadId })).status).toBe(409);
    } else if (action === "downgrade") {
      const response = await fetch(`${base}/api/bots/${main.id}`, { method: "PATCH", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ approvalMode: "ask", applyToAllThreads: true }) });
      expect(response.ok).toBe(true);
    } else {
      await post("/api/paused", { kind: "bot", id: main.id, paused: true });
      expect((await (await fetch(`${base}/api/paused`)).json() as { heldBots: string[] }).heldBots).toContain(main.id);
    }
    writeFileSync(gate, "continue");
    expect((await decision).ok).toBe(true);
    const created = (await bots()).filter(bot => !before.some(previous => previous.id === bot.id));
    expect(created).toHaveLength(1);
    if (action === "stop") await expect.poll(async () => (await rows(created[0].threadId)).filter(row => row.role === "user" && row.text === text).length, { timeout: 20000 }).toBe(1);
    else {
      expect((await rows(created[0].threadId)).some(row => row.role === "user" && row.text === text)).toBe(false);
      if (action === "downgrade") {
        expect(created[0].approvalMode).toBe("full");
        await expect.poll(async () => (await rows(main.threadId)).find(row => row.role === "user" && row.text === text)?.workBotRouting?.state, { timeout: 20000 }).toBe("interrupted");
      }
    }
  } finally {
    writeFileSync(gate, "continue");
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await new Promise<void>(resolve => child!.once("exit", () => resolve())); }
    await fixture?.close();
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
