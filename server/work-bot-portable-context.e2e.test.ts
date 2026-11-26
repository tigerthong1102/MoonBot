import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it("hands the owner's uploaded file and a private copy of the selected Data result to one worker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "workbot-transfer-fixture-"));
  const routes = join(dir, "topics.json"), prompts = join(dir, "prompts.jsonl");
  const owner = randomBytes(32).toString("base64url");
  const token = randomBytes(32).toString("base64url");
  const bytes = "synthetic fixture inventory = 42";
  writeFileSync(routes, "{}");
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, OMB_TEST_DESKTOP_OWNER_TOKEN: owner, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts });
    const base = fixture.info.url;
    const headers = { origin: base, "x-openmausbot-desktop-owner": owner };
    async function api<T>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(base + path, { method: body ? "POST" : "GET", headers: { ...headers, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await res.json();
      expect(res.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    }
    const roster = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const rows = async (thread: string) => (await api<{ messages: Message[] }>(`/api/threads/${thread}/messages`)).messages;
    const main = (await roster()).find(bot => bot.defaultBot)!;
    const upload = await fetch(base + "/api/files?name=inventory.txt&uploadId=" + randomUUID(), { method: "POST", headers: { ...headers, "content-type": "text/plain", "x-startupbot-upload-receipt": token }, body: bytes });
    const saved = await upload.json() as { path: string; handoffReady?: boolean };
    expect(upload.status, JSON.stringify(saved)).toBe(201);
    expect(saved.handoffReady).toBe(true);
    const data = await api<{ card: { id: string } }>(`/api/bots/${main.id}/data/run`, { sql: "SELECT 42 AS quantity", title: "Fixture count" });
    const work = "Monitor the fixture stock count weekly";
    const text = work + '\n\n<attached-file path="' + saved.path + '" name="inventory.txt"/>';
    writeFileSync(routes, JSON.stringify({ [work]: JSON.stringify({ name: "Fixture stock", icon: "box" }) }));
    const send = { text, threadId: main.threadId, sendId: randomUUID(), dataContext: { cardId: data.card.id, draftSql: "SELECT 918273 AS unsaved" }, workBotUploadReceipts: [token] };
    await api(`/api/bots/${main.id}/messages`, send);
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const offer = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    expect(offer.teamSetupRequest?.workBotOffer?.contextBlock).toBeUndefined();
    const answer = { requestId: offer.requestId, behavior: "allow" };
    const reply = await api<{ result: { bots: Array<{ id: string }> }; routingState: string }>(`/api/threads/${main.threadId}/respond`, answer);
    expect(reply.routingState).toBe("dispatched");
    await api(`/api/threads/${main.threadId}/respond`, answer);
    const worker = (await roster()).find(bot => bot.id === reply.result.bots[0]!.id)!;
    const target = (await rows(worker.threadId)).filter(row => row.text === text && row.role === "user");
    expect(target).toHaveLength(1);
    const cardId = target[0]!.dataContext!.cardId;
    expect(target[0]!.dataContext?.draftSql).toBe(send.dataContext.draftSql);
    const page = (bot: string, id: string) => api<{ rows: number[][] }>(`/api/bots/${bot}/data/page`, { cardId: id, offset: 0, limit: 10 });
    expect((await page(worker.id, cardId)).rows).toEqual([[42]]);
    await api(`/api/bots/${worker.id}/data/run`, { cardId, sql: "SELECT 84 AS quantity" });
    expect((await page(worker.id, cardId)).rows).toEqual([[84]]);
    expect((await page(main.id, data.card.id)).rows).toEqual([[42]]);
    const file = await fetch(base + `/api/threads/${worker.threadId}/messages/${target[0]!.id}/file`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: saved.path }) });
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(bytes);
    await expect.poll(() => readFileSync(prompts, "utf8").split("\n").filter(line => line.includes(work)).length, { timeout: 15000 }).toBe(1);
    expect(JSON.stringify(await rows(main.threadId))).not.toContain(token);
    expect(JSON.stringify(target)).not.toContain(token);
  } finally { await fixture?.close(); rmSync(dir, { recursive: true, force: true }); }
}, 90000);
