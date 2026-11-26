import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each([{ choice: "allow", failure: "registry" }, { choice: "allow", failure: "both" }, { choice: "deny", failure: "message" }] as const)("interrupts $choice work when $failure state writes fail", async ({ choice, failure }) => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-stop-failure-"));
  const routes = join(dir, "routes.json"), gate = join(dir, "finish"), marker = join(dir, "fail"), messageMarker = join(dir, "message-fail"), prompts = join(dir, "prompts.jsonl");
  const text = "Track the synthetic stock every week FAILURE_STOP", later = "A different safe request";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Stock", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url"), originalFetch = globalThis.fetch;
  const env = { ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate, FAKE_CLAUDE_PROMPTS: prompts, FAKE_CLAUDE_STOP_REWIND_FAILURE: marker, FAKE_CLAUDE_STOP_MESSAGE_FAILURE: messageMarker, OMB_TEST_DESKTOP_OWNER_TOKEN: token };
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined, child: ChildProcess | undefined;
  try {
    fixture = await launchVerificationServer(env);
    const base = fixture.info.url;
    fixture.child.kill("SIGTERM"); await new Promise<void>(resolve => fixture!.child.once("exit", () => resolve()));
    const childEnv = verificationServerEnvironment(env, fixture.info.dataDir, Number(new URL(base).port));
    child = spawn(process.execPath, ["--import", pathToFileURL(join(process.cwd(), "server/testing/work-bot-stop-failure.mjs")).href, ...verificationServerArgs(childEnv)], { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
    await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
    const call = (path: string, body?: unknown) => fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const api = async <T>(path: string, body?: unknown): Promise<T> => { const response = await call(path, body); const result = await response.json(); expect(response.ok, JSON.stringify(result)).toBe(true); return result as T; };
    const bots = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const main = (await bots()).find(bot => bot.defaultBot)!;
    const rows = async (id: string) => (await api<{ messages: Message[] }>(`/api/threads/${id}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const card = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const accepted = await api<{ result: { bots: { id: string }[] } }>(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: choice });
    const target = choice === "deny" ? main : (await bots()).find(bot => bot.id === accepted.result.bots[0]!.id)!;
    await expect.poll(() => { const saved = JSON.parse(readFileSync(join(fixture!.info.dataDir, "bots.json"), "utf8")) as BotRecord[]; return Boolean(saved.find(bot => bot.id === target.id)?.tasks?.find(task => task.threadId === target.threadId)?.resumeCursors?.claude); }, { timeout: 15000 }).toBe(true);
    if (failure !== "message") writeFileSync(marker, "fail once");
    if (failure !== "registry") writeFileSync(messageMarker, "fail once");
    expect((await call(`/api/bots/${main.id}/interrupt`, { threadId: main.threadId })).status).toBeGreaterThanOrEqual(400);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(messageMarker)).toBe(false);
    await expect.poll(async () => !(await bots()).find(bot => bot.id === target.id)?.busy, { timeout: 15000 }).toBe(true);
    expect(Boolean((await rows(target.threadId)).find(row => row.text === text)?.requestCancelled)).toBe(failure === "registry");
    if (failure === "both") {
      child.kill("SIGTERM"); await new Promise<void>(resolve => child!.once("exit", () => resolve()));
      child = spawn(process.execPath, ["--import", pathToFileURL(join(process.cwd(), "server/testing/work-bot-stop-failure.mjs")).href, ...verificationServerArgs(childEnv)], { cwd: process.cwd(), env: childEnv, stdio: "ignore" });
      await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
    }
    await api(`/api/bots/${target.id}/messages`, { threadId: target.threadId, text: later, sendId: randomUUID() });
    await expect.poll(() => existsSync(fixture!.fixtureDumpPath) && JSON.stringify(JSON.parse(readFileSync(fixture!.fixtureDumpPath, "utf8")).prompt).includes(later), { timeout: 15000 }).toBe(true);
    const resumed = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { argv: string[]; prompt: unknown };
    expect(resumed.argv).not.toContain("--resume");
    expect(JSON.stringify(resumed.prompt)).not.toContain("FAILURE_STOP");
    expect(JSON.stringify(resumed.prompt)).toContain(failure === "registry" ? "This earlier request was stopped" : "may already have started");
  } finally {
    writeFileSync(gate, "finish");
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await new Promise<void>(resolve => child!.once("exit", () => resolve())); }
    await fixture?.close(); globalThis.fetch = originalFetch; rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
