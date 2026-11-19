import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each(["deny", "allow", "queued"])("the main helper offers a bot without interrupting the work, then handles %s once", async scenario => {
  const queued = scenario === "queued";
  const behavior = queued ? "allow" : scenario;
  const gates = mkdtempSync(join(tmpdir(), "work-bot-delivery-"));
  const finishGate = join(gates, "finish");
  const token = randomBytes(32).toString("base64url");
  const fetchNormally = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => fetchNormally(input, { ...init, headers: {
    ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token,
  } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, ...(queued ? { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate } : {}), OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const url = fixture.info.url;
    const api = async <T = unknown>(path: string, body?: unknown, method = body ? "POST" : "GET") => {
      const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    };
    const roster = async (): Promise<BotRecord[]> => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const original = await roster();
    const helper = original.find(bot => bot.defaultBot)!;
    await api(`/api/bots/${helper.id}`, { approvalMode: "full" }, "PATCH");
    const path = `/api/threads/${helper.threadId}`;
    const messages = async (): Promise<Message[]> => (await api<{ messages: Message[] }>(path + "/messages")).messages;
    const work = "Giúp tôi theo dõi các hồ sơ ứng tuyển mỗi tuần.";
    const send = { threadId: helper.threadId, text: work, sendId: randomUUID() };
    const sendPath = `/api/bots/${helper.id}/messages`;
    if (queued) {
      await api(sendPath, { ...send, text: "Xin chào", sendId: randomUUID() });
      const cancelled = await api<{ queueId: string }>(sendPath, { ...send, text: "Theo dõi hàng tồn kho mỗi ngày.", followUp: "queue", sendId: randomUUID() });
      expect(cancelled.queueId).toBeTruthy();
      await api(`/api/bots/${helper.id}/queue/${cancelled.queueId}`, { threadId: helper.threadId }, "DELETE");
      const receipt = await api<{ queued: boolean }>(sendPath, { ...send, followUp: "queue" });
      expect(receipt.queued).toBe(true);
      expect((await messages()).some(row => row.card?.teamSetupRequest?.workBotOffer)).toBe(false);
      writeFileSync(finishGate, "release");
      await expect.poll(async () => (await messages()).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    } else {
      await api(sendPath, send);
      await expect.poll(async () => (await messages()).some(m => m.text === "hello from fake claude"), { timeout: 15000 }).toBe(true);
    }
    await api(sendPath, send);
    const offers = (await messages()).flatMap(m => m.card?.teamSetupRequest?.workBotOffer ? [m.card] : []);
    expect(offers).toHaveLength(1);
    expect(await roster()).toHaveLength(original.length);
    const requestId = offers[0]!.requestId;
    const answer = () => api<{ result: { state: string; bots: { id: string }[] } }>(path + "/respond", { requestId, behavior });
    const result = await answer();
    await answer();
    const added = (await roster()).filter(bot => !original.some(row => row.id === bot.id));
    if (behavior === "deny") {
      expect(result.result.state).toBe("denied");
      expect(added).toHaveLength(0);
    } else {
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ id: result.result.bots[0]!.id, name: "Hồ sơ ứng tuyển", avatarCrop: "rounded" });
      const png = await fetch(url + added[0]!.avatarUrl);
      expect(png.status).toBe(200);
      expect(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    const replies = (await messages()).filter(m => m.role === "bot" && m.kind === "text" && m.text === "hello from fake claude");
    if (!queued) expect(replies).toHaveLength(1);
  } finally {
    globalThis.fetch = fetchNormally;
    await fixture?.close();
    rmSync(gates, { recursive: true, force: true });
  }
}, 60000);
