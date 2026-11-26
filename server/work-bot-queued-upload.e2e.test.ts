import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it("accepts an uploaded file queued during the choice, admits one worker run and acknowledges a lost send response", async () => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-queued-upload-fixture-"));
  const routes = join(dir, "topics.json"), prompts = join(dir, "prompts.jsonl");
  const work = "Monitor the fixture inventory weekly";
  const owner = randomBytes(32).toString("base64url"), token = randomBytes(32).toString("base64url");
  const bytes = "synthetic queued inventory 42";
  writeFileSync(routes, JSON.stringify({ [work]: JSON.stringify({ name: "Fixture inventory", icon: "box" }) }));
  let server: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    server = await launchVerificationServer({ ...process.env, OMB_TEST_DESKTOP_OWNER_TOKEN: owner, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts });
    const base = server.info.url;
    const headers = { origin: base, "x-openmausbot-desktop-owner": owner };
    async function api<T>(path: string, body?: unknown): Promise<T> {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { ...headers, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    }
    const roster = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const rows = async (id: string) => (await api<{ messages: Message[] }>(`/api/threads/${id}/messages`)).messages;
    const main = (await roster()).find(bot => bot.defaultBot)!;
    const sendPath = `/api/bots/${main.id}/messages`;
    await api(sendPath, { text: work, threadId: main.threadId, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const offer = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const upload = await fetch(base + "/api/files?name=count.txt&uploadId=" + randomUUID(), { method: "POST", headers: { ...headers, "content-type": "text/plain", "x-startupbot-upload-receipt": token }, body: bytes });
    const saved = await upload.json() as { path: string; handoffReady?: boolean };
    expect(upload.status).toBe(201);
    expect(saved.handoffReady).toBe(true);
    const text = 'Use these numbers\n\n<attached-file path="' + saved.path + '" name="count.txt" />';
    const data = await api<{ card: { id: string } }>(`/api/bots/${main.id}/data/run`, { sql: "SELECT 42 AS quantity" });
    const dataContext = { cardId: data.card.id, draftSql: "SELECT 73 AS pending" };
    const queued = { text, dataContext, threadId: main.threadId, sendId: randomUUID(), followUp: "queue", workBotUploadReceipts: [token] };
    const pending = await api<{ queueId: string }>(sendPath, queued);
    expect(pending.queueId).toBeTruthy();
    const changedDraftStatus = async () => (await fetch(base + sendPath, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ ...queued, dataContext: { ...dataContext, draftSql: "SELECT 74 AS different" } }) })).status;
    expect(await changedDraftStatus()).toBe(409);
    const allowed = await api<{ routingState: string; result: { bots: [{ id: string }] } }>(`/api/threads/${main.threadId}/respond`, { requestId: offer.requestId, behavior: "allow" });
    expect(allowed.routingState).toBe("dispatched");
    const worker = (await roster()).find(bot => bot.id === allowed.result.bots[0].id)!;
    const message = (await rows(worker.threadId)).filter(row => row.sendId === queued.sendId);
    expect(message).toHaveLength(1);
    expect(message[0]?.queueId).toBe(pending.queueId);
    const file = await fetch(base + `/api/threads/${worker.threadId}/messages/${message[0]!.id}/file`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: saved.path }) });
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(bytes);
    const retry = await api<{ transferred: boolean; queueId: string }>(sendPath, queued);
    expect(retry).toMatchObject({ transferred: true, queueId: pending.queueId });
    expect(await changedDraftStatus()).toBe(409);
    const calls = () => existsSync(prompts) ? readFileSync(prompts, "utf8").split("\n").filter(line => line.includes(work)) : [];
    await expect.poll(() => calls().length, { timeout: 15000 }).toBe(1);
    expect(calls()[0]).toContain("Use these numbers");
    expect(calls()[0]).not.toContain(token);
    expect((await rows(main.threadId)).filter(row => row.sendId === queued.sendId)).toHaveLength(0);
  } finally { await server?.close(); rmSync(dir, { recursive: true, force: true }); }
}, 75000);
