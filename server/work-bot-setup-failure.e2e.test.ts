import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each([
  { method: "setTaskAskedAt", crash: false }, { method: "setTaskActivity", crash: false },
  { method: "setTaskAskedAt", crash: true }, { method: "setTaskActivity", crash: true },
  { method: "setTaskActivity", crash: false, recoverFail: true },
  { method: "setTaskActivity", crash: false, cleanupFail: true, same: false },
  { method: "setTaskActivity", crash: false, cleanupFail: true, same: true },
  { method: "setTaskActivity", crash: false, cleanupFail: true, same: true, oldBranch: true },
])("protects staged work after synthetic $method failure (crash: $crash, recovery failure: $recoverFail, cleanup: $cleanupFail, same: $same, old branch: $oldBranch)", async ({ method, crash, recoverFail, cleanupFail, same, oldBranch }) => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-failed-setup-"));
  const routes = join(dir, "routes.json"), prompts = join(dir, "prompts.jsonl"), marker = join(dir, "fault");
  const text = "Follow the synthetic inventory on Mondays";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Inventory", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url");
  const env = { ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, FAKE_CLAUDE_WORK_BOT_FAULT_METHOD: method, FAKE_CLAUDE_WORK_BOT_FAULT_MARKER: marker, ...(crash ? { FAKE_CLAUDE_WORK_BOT_FAULT_CRASH: "1" } : {}), ...(recoverFail ? { FAKE_CLAUDE_WORK_BOT_FAULT_RECOVERY: join(dir, "recovery-fault") } : {}), ...(cleanupFail ? { FAKE_CLAUDE_WORK_BOT_CLEANUP_FAIL: "1", FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: join(dir, "finish") } : {}), OMB_TEST_DESKTOP_OWNER_TOKEN: token };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  let restarted: ChildProcess | undefined;
  try {
    fixture = await launchVerificationServer(env);
    const base = fixture.info.url;
    fixture.child.kill("SIGTERM");
    await new Promise<void>(resolve => fixture!.child.once("exit", () => resolve()));
    const childEnv = verificationServerEnvironment(env, fixture.info.dataDir, Number(new URL(base).port));
    const preload = pathToFileURL(join(process.cwd(), "server/testing/work-bot-fault-preload.mjs")).href;
    restarted = spawn(process.execPath, ["--import", preload, ...verificationServerArgs(childEnv)], { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value as T;
    };
    const bots = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const main = (await bots()).find(bot => bot.defaultBot)!;
    const rows = async (threadId: string) => (await api<{ messages: Message[] }>(`/api/threads/${threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const card = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const workerId = same ? main.id : card.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId;
    if (crash) {
      await fetch(`${base}/api/threads/${main.threadId}/respond`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ requestId: card.requestId, behavior: "allow" }) }).catch(() => undefined);
      if (restarted.exitCode === null && restarted.signalCode === null) await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
      restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
      await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
    } else {
      const accepted = await api<{ routingState: string }>(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: same ? "deny" : "allow" });
      expect(accepted.routingState).toBe(recoverFail || cleanupFail ? "dispatching" : "interrupted");
    }
    expect(existsSync(marker)).toBe(true);
    let worker = (await bots()).find(bot => bot.id === workerId)!;
    let olderMessageId: string | undefined;
    if (recoverFail || cleanupFail) {
      if (recoverFail) expect(existsSync(join(dir, "recovery-fault"))).toBe(true);
      if (cleanupFail) expect((await rows(main.threadId)).find(row => row.text === text)?.workBotRouting?.recoveryBlocked).toBe(true);
      if (cleanupFail) {
        const stop = await fetch(`${base}/api/bots/${main.id}/interrupt`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ threadId: main.threadId }) });
        expect(stop.status).toBe(409);
        expect((await rows(main.threadId)).find(row => row.text === text)?.workBotRouting?.state).toBe("dispatching");
        const attempt = await fetch(`${base}/api/bots/${worker.id}/messages`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ threadId: worker.threadId, text: "Restart must not queue", followUp: "restart", sendId: randomUUID() }) });
        expect(attempt.status).toBe(409);
        const snapshot = await api<{ botQueuedMessages?: Record<string, Array<{ text: string }>> }>("/api/bots?messages=0");
        expect(snapshot.botQueuedMessages?.[worker.threadId]?.some(item => item.text === "Restart must not queue") ?? false).toBe(false);
      }
      if (cleanupFail && same) {
        const beforeBranch = await api<{ activeLeafId: string; messages: Message[] }>(`/api/threads/${main.threadId}/messages`);
        const existing = beforeBranch.messages.find(row => row.id !== beforeBranch.activeLeafId)!;
        expect(existing?.id).toBeTruthy();
        olderMessageId = existing.id;
        const branch = await fetch(`${base}/api/bots/${main.id}/active-branch`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ threadId: main.threadId, messageId: existing.id }) });
        expect(branch.status).toBe(409);
        expect((await api<{ activeLeafId: string }>(`/api/threads/${main.threadId}/messages`)).activeLeafId).toBe(beforeBranch.activeLeafId);
        const typed = await fetch(`${base}/api/bots/${main.id}/messages`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ threadId: main.threadId, text: "stop", sendId: randomUUID() }) });
        expect(typed.status).toBe(409);
        expect((await rows(main.threadId)).some(row => row.text === "stop")).toBe(false);
      }
      if (cleanupFail && !same) {
        const other = (await api<{ bot: BotRecord }>("/api/bots", { name: "Other fixture" })).bot;
        await api(`/api/bots/${other.id}/messages`, { threadId: other.threadId, text: "Other synthetic work", sendId: randomUUID() });
        await expect.poll(async () => (await bots()).find(bot => bot.id === other.id)?.busy, { timeout: 20000 }).toBe(true);
        const pauseResponse = await fetch(`${base}/api/paused`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ kind: "all", paused: true }) });
        expect(pauseResponse.ok).toBe(false);
        const pause = await api<{ all?: boolean; heldBots: string[] }>("/api/paused");
        expect(pause.all).toBe(true);
        expect(pause.heldBots).toContain(other.id);
        await expect.poll(async () => (await bots()).find(bot => bot.id === other.id)?.busy, { timeout: 20000 }).toBe(false);
        expect((await rows(main.threadId)).find(row => row.text === text)?.workBotRouting?.state).toBe("dispatching");
        await api("/api/paused", { kind: "all", paused: false });
      }
      if (cleanupFail) writeFileSync(join(dir, "finish"), "release");
      const queued = await api<{ queued?: boolean }>(`/api/bots/${worker.id}/messages`, { threadId: worker.threadId, text: "Queued status note", sendId: randomUUID() });
      expect(queued.queued).toBe(true);
      restarted.kill("SIGKILL");
      await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
      if (oldBranch) {
        const database = new DatabaseSync(join(fixture.info.dataDir, "messages.db"));
        database.prepare("UPDATE thread_state SET active_leaf_id = ? WHERE thread_id = ?").run(olderMessageId!, main.threadId);
        database.close();
      }
      restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
      await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
      worker = (await bots()).find(bot => bot.id === workerId)!;
    }
    const target = (await rows(worker.threadId)).find(row => row.text === text)!;
    expect(target).toMatchObject({ workBotExecutionUncertain: true, requestPending: false });
    expect(target.workBotRecoveryPending).toBeUndefined();
    const followup = "Check the synthetic status";
    await api(`/api/bots/${worker.id}/messages`, { threadId: worker.threadId, text: followup, sendId: randomUUID() });
    await expect.poll(async () => { const messages = await rows(worker.threadId); const i = messages.findIndex(row => row.text === followup); return i >= 0 && messages.slice(i + 1).some(row => row.role === "bot" && row.kind === "text"); }, { timeout: 20000 }).toBe(true);
    const captured = readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown);
    const nextPrompt = JSON.stringify(captured.find(prompt => JSON.stringify(prompt).includes(followup)));
    expect(nextPrompt).not.toContain(text);
    expect(JSON.stringify(captured)).not.toContain(text);
    if (!oldBranch) expect(JSON.stringify(captured)).toContain("Do not repeat it automatically");
    if (oldBranch) {
      expect((await rows(main.threadId)).find(row => row.text === text)?.workBotRouting?.state).toBe("interrupted");
      await expect.poll(async () => (await rows(main.threadId)).find(row => row.text === followup)?.requestPending, { timeout: 20000 }).toBe(false);
      await expect.poll(() => {
        const database = new DatabaseSync(join(fixture!.info.dataDir, "messages.db"));
        try { return database.prepare("SELECT count(*) AS count FROM messages WHERE json_extract(json, '$.requestPending') = 1 OR json_extract(json, '$.workBotRecoveryPending') = 1").get()!.count; }
        finally { database.close(); }
      }, { timeout: 20000 }).toBe(0);
      restarted.kill("SIGTERM");
      await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
      const savedTask = () => (JSON.parse(readFileSync(join(fixture!.info.dataDir, "bots.json"), "utf8")) as BotRecord[]).find(row => row.id === main.id)!.tasks!.find(task => task.threadId === main.threadId)!;
      const cursor = structuredClone(savedTask().resumeCursors);
      restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
      await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
      expect((await rows(main.threadId)).find(row => row.text === text)?.requestPending).toBe(false);
      expect(savedTask().resumeCursors).toEqual(cursor);
    }
  } finally {
    if (restarted && restarted.exitCode === null && restarted.signalCode === null) {
      restarted.kill("SIGTERM");
      await new Promise<void>(resolve => restarted!.once("exit", () => resolve()));
    }
    await fixture?.close();
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
