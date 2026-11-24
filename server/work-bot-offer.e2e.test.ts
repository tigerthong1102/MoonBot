import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it("does not hand off a compacted conversation without its summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-compacted-context-"));
  const routes = join(dir, "routes.json"), prompts = join(dir, "prompts.jsonl");
  const work = "Monitor the corrected inventory every week";
  writeFileSync(routes, JSON.stringify({ "The initial count is 10": "null", "Correction: the count is 42": "null", [work]: JSON.stringify({ name: "Inventory", icon: "box" }) }));
  const ownerToken = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": ownerToken } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: ownerToken });
    const base = fixture.info.url;
    const request = (path: string, body?: unknown) => fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const bots = async () => (await (await request("/api/bots?messages=0")).json() as { bots: BotRecord[] }).bots;
    const before = await bots(), main = before.find(bot => bot.defaultBot)!;
    const rows = async () => (await (await request(`/api/threads/${main.threadId}/messages`)).json() as { messages: Message[] }).messages;
    for (const text of ["The initial count is 10", "Correction: the count is 42"]) {
      expect((await request(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() })).ok).toBe(true);
      await expect.poll(async () => (await rows()).some(row => row.role === "user" && row.text === text && row.requestPending === false), { timeout: 15000 }).toBe(true);
    }
    expect((await request(`/api/bots/${main.id}/compact`, { threadId: main.threadId })).ok).toBe(true);
    await expect.poll(async () => (await rows()).some(row => row.kind === "compaction" && !row.compaction?.fresh), { timeout: 20000 }).toBe(true);
    await expect.poll(async () => !(await bots()).find(bot => bot.id === main.id)?.busy, { timeout: 15000 }).toBe(true);
    const summary = (await rows()).findLast(row => row.kind === "compaction" && row.compaction?.by === "person" && !row.compaction.fresh)?.compaction?.summary;
    expect(summary?.trim()).toBeTruthy();
    const sendId = randomUUID();
    expect((await request(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: work, sendId })).ok).toBe(true);
    await expect.poll(async () => {
      const messages = await rows(), source = messages.find(row => row.role === "user" && row.sendId === sendId);
      return Boolean(source && messages.some(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === source.id && row.card.teamSetupRequest.workBotOffer.contextBlock === "data"));
    }, { timeout: 20000 }).toBe(true);
    const messages = await rows(), sources = messages.filter(row => row.role === "user" && row.sendId === sendId);
    expect(sources).toHaveLength(1);
    const sourceId = sources[0]!.id;
    const card = messages.find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === sourceId)!.card!;
    const respond = (behavior: string) => request(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior });
    expect((await respond("allow")).status).toBe(409);
    expect((await respond("deny")).ok).toBe(true);
    await expect.poll(async () => {
      return (await rows()).some(row => row.requestMessageId === sourceId && row.turnTerminal && row.turnSucceeded);
    }, { timeout: 20000 }).toBe(true);
    const delivered = readFileSync(prompts, "utf8").trim().split("\n").filter(line => line.includes(work));
    expect(delivered).toHaveLength(1);
    const content = (JSON.parse(delivered[0]!) as { message: { content: string } }).message.content;
    expect(content).toContain("Earlier conversation summary");
    expect(content).toContain(JSON.stringify(summary));
    expect(content).toContain("Correction: the count is 42");
    expect(await bots()).toHaveLength(before.length);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);

it("keeps widget-dependent work in the source conversation without a duplicate run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-widget-context-"));
  const gate = join(dir, "finish"), routes = join(dir, "routes.json"), prompts = join(dir, "prompts.jsonl");
  const work = "Monitor this synthetic widget every week";
  writeFileSync(routes, JSON.stringify({ "Show synthetic inventory": "null", [work]: JSON.stringify({ name: "Inventory", icon: "box" }) }));
  const ownerToken = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": ownerToken } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: ownerToken });
    const base = fixture.info.url;
    const request = (path: string, body?: unknown, token?: string, method = body ? "POST" : "GET") => fetch(base + path, { method, headers: { origin: base, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const bots = async () => (await (await request("/api/bots?messages=0")).json() as { bots: BotRecord[] }).bots;
    const before = await bots(), main = before.find(bot => bot.defaultBot)!;
    const rows = async () => (await (await request(`/api/threads/${main.threadId}/messages`)).json() as { messages: Message[] }).messages;
    expect((await request(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: "Show synthetic inventory", sendId: randomUUID() })).ok).toBe(true);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture!.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.OMB_COMMS_TOKEN; } catch { return false; }
      return Boolean(token);
    }, { timeout: 15000 }).toBe(true);
    expect((await request("/api/internal/options-card", { tool: "show_widget", widget: { type: "Card", title: "Synthetic inventory: 42" } }, token)).status).toBe(201);
    writeFileSync(gate, "finish");
    await expect.poll(async () => !(await bots()).find(bot => bot.id === main.id)?.busy, { timeout: 15000 }).toBe(true);
    expect((await rows()).some(row => row.kind === "widget" && row.text?.includes("Synthetic inventory: 42"))).toBe(true);
    expect((await request(`/api/bots/${main.id}`, { cwd: dir }, undefined, "PATCH")).ok).toBe(true);
    const sendId = randomUUID();
    expect((await request(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: work, sendId })).ok).toBe(true);
    await expect.poll(async () => {
      const messages = await rows(), source = messages.find(row => row.role === "user" && row.sendId === sendId);
      return Boolean(source && messages.some(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === source.id && row.card.teamSetupRequest.workBotOffer.contextBlock === "data"));
    }, { timeout: 20000 }).toBe(true);
    const messages = await rows(), sources = messages.filter(row => row.role === "user" && row.sendId === sendId);
    expect(sources).toHaveLength(1);
    const sourceId = sources[0]!.id;
    const card = messages.find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId === sourceId)!.card!;
    const respond = (behavior: string) => request(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior });
    expect((await respond("allow")).status).toBe(409);
    expect((await respond("deny")).ok).toBe(true);
    await expect.poll(async () => (await rows()).find(row => row.id === sourceId)?.workBotRouting?.state, { timeout: 20000 }).toBe("dispatched");
    await expect.poll(() => existsSync(prompts) && readFileSync(prompts, "utf8").trim().split("\n").filter(line => line.includes(work)).length, { timeout: 20000 }).toBe(1);
    expect(readFileSync(prompts, "utf8").trim().split("\n").find(line => line.includes(work))).toContain("Synthetic inventory: 42");
    await expect.poll(async () => {
      return (await rows()).some(row => row.requestMessageId === sourceId && row.turnTerminal && row.turnSucceeded);
    }, { timeout: 20000 }).toBe(true);
    expect(readFileSync(prompts, "utf8").trim().split("\n").filter(line => line.includes(work))).toHaveLength(1);
    expect(await bots()).toHaveLength(before.length);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it("keeps work referring to a relative fixture file in its original conversation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-relative-file-"));
  const routes = join(dir, "routes.json");
  const text = "Theo dõi hoadon.numbers mỗi tuần";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Hóa đơn", icon: "ledger" }) }));
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const bots = async () => (await (await fetch(`${base}/api/bots?messages=0`)).json() as { bots: BotRecord[] }).bots;
    const before = await bots(), main = before.find(bot => bot.defaultBot)!;
    const sent = await fetch(`${base}/api/bots/${main.id}/messages`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ threadId: main.threadId, text, sendId: randomUUID() }) });
    expect(sent.ok).toBe(true);
    const rows = async () => (await (await fetch(`${base}/api/threads/${main.threadId}/messages`)).json() as { messages: Message[] }).messages;
    await expect.poll(async () => (await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer?.contextBlock === "files"), { timeout: 20000 }).toBe(true);
    const offer = (await rows()).find(row => row.card?.teamSetupRequest?.workBotOffer?.contextBlock === "files")!.card!;
    const decision = (behavior: string) => fetch(`${base}/api/threads/${main.threadId}/respond`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ requestId: offer.requestId, behavior }) });
    expect((await decision("allow")).status).toBe(409);
    expect((await decision("deny")).ok).toBe(true);
    await expect.poll(async () => (await rows()).find(row => row.text === text)?.workBotRouting?.state, { timeout: 20000 }).toBe("dispatched");
    await expect.poll(async () => { const messages = await rows(); const index = messages.findIndex(row => row.text === text); return index >= 0 && messages.slice(index + 1).some(row => row.role === "bot" && row.kind === "text"); }, { timeout: 20000 }).toBe(true);
    expect((await rows()).find(row => row.card?.requestId === offer.requestId)?.card?.answered).toBe("deny");
    expect(await bots()).toHaveLength(before.length);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it.each(["deny", "allow", "queued", "codex", "unsupported"])("the main helper offers a bot without interrupting the work, then handles %s once", async scenario => {
  const queued = scenario === "queued";
  const codex = scenario === "codex";
  const behavior = scenario === "deny" ? "deny" : "allow";
  const gates = mkdtempSync(join(tmpdir(), "work-bot-delivery-"));
  const finishGate = join(gates, "finish");
  const work = codex ? "Tôi cần theo dõi tin tuc AI hang ngay, cap nhat lien tuc cho toi nhe" : queued ? "Giúp tôi theo dõi các hồ sơ ứng tuyển mỗi tuần." : scenario === "allow" ? "毎朝、市内の通行止めを調べて変化を知らせてください。" : "أخبرني يوميًا بأي تغييرات في أسعار الورق.";
  const name = codex ? "Tin tức AI" : queued ? "Hồ sơ ứng tuyển" : scenario === "allow" ? "道路情報" : "أسعار الورق";
  const codexLog = join(gates, "codex-calls.jsonl");
  const promptLog = join(gates, "prompts.jsonl");
  const workPrompts = () => existsSync(promptLog) ? readFileSync(promptLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(work)) : [];
  let selectedModel: string | undefined;
  const textRoutes = join(gates, "text-routes.json");
  writeFileSync(textRoutes, JSON.stringify({ [work]: JSON.stringify({ name, icon: "tasks" }), "Xin chào": "null" }));
  const token = randomBytes(32).toString("base64url");
  const fetchNormally = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => fetchNormally(input, { ...init, headers: {
    ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token,
  } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: textRoutes, FAKE_CLAUDE_PROMPTS: promptLog, FAKE_CODEX_TEXT_ROUTES: textRoutes, FAKE_CODEX_TEXT_LOG: codexLog, ...(queued ? { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate } : {}), OMB_TEST_DESKTOP_OWNER_TOKEN: token },
      undefined, undefined, undefined, undefined, undefined, codex ? ["codex"] : []);
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
    if (codex) {
      selectedModel = "gpt-page-two";
      await api(`/api/bots/${helper.id}/tasks/${helper.threadId}`, { modelSelection: { instanceId: "codex", model: selectedModel } }, "PATCH");
    }
    await api(`/api/bots/${helper.id}`, { approvalMode: "full" }, "PATCH");
    const path = `/api/threads/${helper.threadId}`;
    const messages = async (): Promise<Message[]> => (await api<{ messages: Message[] }>(path + "/messages")).messages;
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
    }
    await expect.poll(async () => (await messages()).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    if (codex) {
      const calls = readFileSync(codexLog, "utf8").trim().split("\n").map(line => JSON.parse(line) as { argv: string[]; prompt: string });
      const call = calls.find(row => row.prompt.includes(work));
      expect(call?.argv).toContain("exec");
      expect(call?.argv[(call?.argv.indexOf("--model") ?? -1) + 1]).toBe(selectedModel);
    }
    await api(sendPath, send);
    const offers = (await messages()).flatMap(m => m.card?.teamSetupRequest?.workBotOffer ? [m.card] : []);
    expect(offers).toHaveLength(1);
    expect(await roster()).toHaveLength(original.length);
    if (!queued && !codex) expect(workPrompts()).toHaveLength(0);
    const clarification = "Chỉ theo dõi tuyến đường quanh nhà tôi.";
    const clarificationSendId = randomUUID();
    if (scenario === "allow") {
      const receipt = await api<{ queued: boolean; queueId: string }>(sendPath, { threadId: helper.threadId, text: clarification, sendId: clarificationSendId });
      expect(receipt.queued).toBe(true);
      const db = new DatabaseSync(join(fixture.info.dataDir, "messages.db"), { readOnly: true });
      try {
        const row = db.prepare("SELECT payload FROM chat_followups WHERE id = ?").get(receipt.queueId) as { payload: string };
        expect(JSON.parse(row.payload).workBotOfferSource).toBe((await messages()).find(message => message.text === work)?.id);
      } finally { db.close(); }
    }
    const requestId = offers[0]!.requestId;
    if (scenario === "unsupported") {
      const originalMessage = (await messages()).find(row => row.role === "user" && row.text === work)!;
      const pending = await api<{ queueId: string }>(sendPath, { threadId: helper.threadId, text: "A reply with context", replyToId: originalMessage.id, sendId: randomUUID() });
      const refused = await fetch(url + path + "/respond", { method: "POST", headers: { origin: url, "content-type": "application/json" }, body: JSON.stringify({ requestId, behavior: "allow" }) });
      expect(refused.status).toBe(409);
      expect((await refused.json() as { error: string }).error).toContain("queued messages");
      expect(await roster()).toHaveLength(original.length);
      expect((await messages()).find(row => row.card?.requestId === requestId)?.card?.answered).toBeUndefined();
      await api(`/api/bots/${helper.id}/queue/${pending.queueId}`, { threadId: helper.threadId }, "DELETE");
    }
    const answer = () => api<{ result: { state: string; bots: { id: string }[] } }>(path + "/respond", { requestId, behavior });
    const result = await answer();
    await answer();
    const added = (await roster()).filter(bot => !original.some(row => row.id === bot.id));
    if (behavior === "deny") {
      expect(result.result.state).toBe("denied");
      expect(added).toHaveLength(0);
    } else {
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ id: result.result.bots[0]!.id, name, avatarCrop: "rounded" });
      if (codex) expect(added[0]!.modelSelection).toMatchObject({ instanceId: "codex", model: selectedModel });
      await expect.poll(async () => (await api<{ messages: Message[] }>(`/api/threads/${added[0]!.threadId}/messages`)).messages.some(row => row.role === "user" && row.text?.includes(work)), { timeout: 15000 }).toBe(true);
      if (scenario === "allow") {
        expect((await api<{ transferred: boolean }>(sendPath, { threadId: helper.threadId, text: clarification, sendId: clarificationSendId })).transferred).toBe(true);
        await expect.poll(async () => (await api<{ messages: Message[] }>(`/api/threads/${added[0]!.threadId}/messages`)).messages.some(row => row.role === "user" && row.text === clarification), { timeout: 15000 }).toBe(true);
        expect((await messages()).some(row => row.role === "user" && row.text === clarification)).toBe(false);
      }
      if (!codex) await expect.poll(async () => (await api<{ messages: Message[] }>(`/api/threads/${added[0]!.threadId}/messages`)).messages.filter(row => row.role === "bot" && row.kind === "text" && row.text === "hello from fake claude").length, { timeout: 15000 }).toBe(1);
      if (scenario === "allow") await expect.poll(async () => {
        const rows = (await api<{ messages: Message[] }>(`/api/threads/${added[0]!.threadId}/messages`)).messages;
        return rows.find(row => row.role === "user" && row.text === work)?.requestPending === false && rows.find(row => row.text === clarification)?.workBotRecoveryPending !== true;
      }, { timeout: 15000 }).toBe(true);
      if (!queued && !codex) expect(workPrompts()).toHaveLength(1);
      if (scenario === "allow") expect(JSON.stringify(workPrompts()[0]).split(clarification)).toHaveLength(2);
      if (scenario === "allow") {
        const conflict = await fetch(url + sendPath, { method: "POST", headers: { origin: url, "content-type": "application/json" }, body: JSON.stringify({ threadId: helper.threadId, text: "Different text", sendId: clarificationSendId }) });
        expect(conflict.status).toBe(409);
        for (const changed of [{ followUp: "restart" }, { mode: "goal" }, { widgetAction: { messageId: "fixture", action: "confirm" } }, { dataContext: { cardId: "c_1" } }]) {
          const mismatch = await fetch(url + sendPath, { method: "POST", headers: { origin: url, "content-type": "application/json" }, body: JSON.stringify({ threadId: helper.threadId, text: clarification, sendId: clarificationSendId, ...changed }) });
          expect(mismatch.status).toBe(409);
        }
        expect(workPrompts()).toHaveLength(1);
      }
      const png = await fetch(url + added[0]!.avatarUrl);
      expect(png.status).toBe(200);
      expect(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    const replies = (await messages()).filter(m => m.role === "bot" && m.kind === "text" && m.text === "hello from fake claude");
    if (!queued && !codex && behavior === "allow") expect(replies).toHaveLength(0);
    if (!queued && !codex && behavior === "deny") await expect.poll(async () => (await messages()).filter(m => m.role === "bot" && m.kind === "text" && m.text === "hello from fake claude").length, { timeout: 15000 }).toBe(1);
  } finally {
    globalThis.fetch = fetchNormally;
    await fixture?.close();
    rmSync(gates, { recursive: true, force: true });
  }
}, 60000);

it("hands the earlier conversation and a reply to the new bot without running the request on the main bot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-context-"));
  const routes = join(dir, "routes.json");
  const prompts = join(dir, "prompts.jsonl");
  const work = "Please monitor the stock count every week";
  const dataWork = "Monitor the synthetic sales report every week";
  writeFileSync(routes, JSON.stringify({ [work]: JSON.stringify({ name: "Stock count", icon: "box" }), [dataWork]: JSON.stringify({ name: "Sales report", icon: "chart" }), "The warehouse is in Hanoi": "null", "SYNTHETIC_PRIVATE_BEFORE_RESET": "null", "Examine this synthetic data": "null" }));
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    };
    const roster = () => api<{ bots: BotRecord[] }>("/api/bots?messages=0");
    const main = (await roster()).bots.find(bot => bot.defaultBot)!;
    const sourcePath = `/api/threads/${main.threadId}/messages`;
    const rows = async () => (await api<{ messages: Message[] }>(sourcePath)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: "SYNTHETIC_PRIVATE_BEFORE_RESET", sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.role === "bot" && row.text === "hello from fake claude"), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => !(await roster()).bots.find(bot => bot.id === main.id)?.busy, { timeout: 15000 }).toBe(true);
    await api(`/api/bots/${main.id}/start-fresh`, { threadId: main.threadId });
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: "The warehouse is in Hanoi", sendId: randomUUID() });
    await expect.poll(async () => (await rows()).filter(row => row.role === "bot" && row.text === "hello from fake claude").length >= 2, { timeout: 15000 }).toBe(true);
    const previous = (await rows()).findLast(row => row.role === "bot" && row.text === "hello from fake claude")!;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: work, replyToId: previous.id, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId), { timeout: 20000 }).toBe(true);
    const offer = (await rows()).find(row => row.card?.teamSetupRequest?.workBotOffer?.sourceMessageId)?.card;
    expect(offer?.requestId).toBeTruthy();
    expect(offer?.subtitle).toBe(work);
    const result = await api<{ result: { bots: Array<{ id: string }> } }>(`/api/threads/${main.threadId}/respond`, { requestId: offer!.requestId, behavior: "allow" });
    const worker = (await roster()).bots.find(bot => bot.id === result.result.bots[0]?.id)!;
    expect(worker.soul).not.toContain(work);
    expect(worker.description).not.toContain(work);
    await expect.poll(async () => {
      const target = (await api<{ messages: Message[] }>(`/api/threads/${worker.threadId}/messages`)).messages;
      const sentIndex = target.findIndex(row => row.role === "user" && row.text === work);
      return sentIndex >= 0 && target.slice(sentIndex + 1).some(row => row.role === "bot" && row.text === "hello from fake claude");
    }, { timeout: 15000 }).toBe(true);
    const targetRows = (await api<{ messages: Message[] }>(`/api/threads/${worker.threadId}/messages`)).messages;
    expect(targetRows.some(row => row.role === "user" && row.text === "The warehouse is in Hanoi")).toBe(true);
    expect(JSON.stringify(targetRows)).not.toContain("SYNTHETIC_PRIVATE_BEFORE_RESET");
    const sent = targetRows.find(row => row.role === "user" && row.text === work)!;
    expect(targetRows.find(row => row.id === sent.replyToId)?.text).toBe(previous.text);
    const providerPrompts = readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(work));
    expect(providerPrompts).toHaveLength(1);
    expect(JSON.stringify(providerPrompts[0]).split(work)).toHaveLength(2);
    expect(JSON.stringify(providerPrompts[0])).toContain("The warehouse is in Hanoi");
    expect(JSON.stringify(providerPrompts[0])).toContain("Historical conversation context");
    expect(JSON.stringify(providerPrompts[0])).not.toContain("SYNTHETIC_PRIVATE_BEFORE_RESET");
    await expect.poll(async () => !(await roster()).bots.find(bot => bot.id === main.id)?.busy, { timeout: 15000 }).toBe(true);
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: "Examine this synthetic data", dataContext: { cardId: "c_42", draftSql: "SELECT 42" }, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.text === "Examine this synthetic data" && row.dataContext?.cardId === "c_42"), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => !(await roster()).bots.find(bot => bot.id === main.id)?.busy, { timeout: 15000 }).toBe(true);
    const before = (await roster()).bots.length;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: dataWork, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer?.contextBlock === "data"), { timeout: 20000 }).toBe(true);
    const blocked = (await rows()).find(row => row.card?.teamSetupRequest?.workBotOffer?.contextBlock === "data")!.card!;
    const refused = await fetch(`${base}/api/threads/${main.threadId}/respond`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ requestId: blocked.requestId, behavior: "allow" }) });
    expect(refused.status).toBe(409);
    await api(`/api/threads/${main.threadId}/respond`, { requestId: blocked.requestId, behavior: "deny" });
    await expect.poll(async () => (await rows()).find(row => row.text === dataWork)?.workBotRouting?.state, { timeout: 20000 }).toBe("dispatched");
    await expect.poll(() => readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(dataWork)).length, { timeout: 15000 }).toBe(1);
    await expect.poll(async () => {
      const messages = await rows();
      const index = messages.findIndex(row => row.text === dataWork);
      return index >= 0 && messages.slice(index + 1).some(row => row.role === "bot" && row.kind === "text") && !(await roster()).bots.find(bot => bot.id === main.id)?.busy;
    }, { timeout: 15000 }).toBe(true);
    expect(readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(dataWork))).toHaveLength(1);
    expect((await rows()).find(row => row.card?.requestId === blocked.requestId)?.card?.answered).toBe("deny");
    expect((await roster()).bots).toHaveLength(before);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it("stops a request while work-bot classification is stalled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-stop-"));
  const prompts = join(dir, "prompts.jsonl");
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_HANG: "1", FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    };
    const main = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.defaultBot)!;
    const rows = async () => (await api<{ messages: Message[] }>(`/api/threads/${main.threadId}/messages`)).messages;
    const text = "Follow the synthetic inventory every week";
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).find(row => row.text === text)?.workBotRouting?.state, { timeout: 15000 }).toBe("classifying");
    await api(`/api/bots/${main.id}/interrupt`, { threadId: main.threadId });
    await expect.poll(async () => (await rows()).find(row => row.text === text)?.workBotRouting?.state, { timeout: 15000 }).toBe("cancelled");
    expect((await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer)).toBe(false);
    expect(existsSync(prompts) ? readFileSync(prompts, "utf8") : "").not.toContain(text);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it("does not replay a stopped work-bot request in a later main-chat turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-stop-followup-"));
  const routes = join(dir, "routes.json"), prompts = join(dir, "prompts.jsonl");
  const text = "Track the synthetic stock each week STOPPED_SENTINEL", later = "Xin chào lần sau", nextWork = "Track the synthetic temperature daily";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Stock", icon: "box" }), [later]: "null", [nextWork]: JSON.stringify({ name: "Temperature", icon: "tasks" }) }));
  const token = randomBytes(32).toString("base64url"), originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json(); expect(response.ok, JSON.stringify(value)).toBe(true); return value as T;
    };
    const main = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.defaultBot)!;
    const rows = async () => (await api<{ messages: Message[] }>(`/api/threads/${main.threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    await api(`/api/bots/${main.id}/interrupt`, { threadId: main.threadId });
    await expect.poll(async () => (await rows()).find(row => row.text === text)?.workBotRouting?.state, { timeout: 15000 }).toBe("cancelled");
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: later, sendId: randomUUID() });
    await expect.poll(() => existsSync(prompts) && readFileSync(prompts, "utf8").includes(later), { timeout: 20000 }).toBe(true);
    const providerCalls = readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown);
    expect(providerCalls).toHaveLength(1);
    expect(JSON.stringify(providerCalls[0])).not.toContain("STOPPED_SENTINEL");
    expect(JSON.stringify(providerCalls[0])).toContain("This earlier request was stopped");
    expect((await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.filter(bot => !bot.defaultBot)).toHaveLength(0);
    await expect.poll(async () => !(await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.id === main.id)?.busy, { timeout: 15000 }).toBe(true);
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: nextWork, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer && !row.card.answered && !row.card.dismissed), { timeout: 20000 }).toBe(true);
    const card = (await rows()).find(row => row.card?.teamSetupRequest?.workBotOffer && !row.card.answered && !row.card.dismissed)!.card!;
    await api(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    await expect.poll(() => readFileSync(prompts, "utf8").trim().split("\n").length, { timeout: 20000 }).toBe(2);
    const transferredCall = JSON.stringify(JSON.parse(readFileSync(prompts, "utf8").trim().split("\n")[1]!));
    expect(transferredCall).toContain(nextWork);
    expect(transferredCall).not.toContain("STOPPED_SENTINEL");
  } finally {
    globalThis.fetch = originalFetch; await fixture?.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it("keeps follow-up work with a synthetic file in the original conversation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-file-context-"));
  const path = join(dir, "Tệp thử.txt");
  const routes = join(dir, "routes.json");
  const prompts = join(dir, "prompts.jsonl");
  const withFile = `Review <attached-file path="${path}" name="Tệp thử.txt"/>`;
  const work = "Monitor this synthetic file each week";
  writeFileSync(path, "synthetic fixture only");
  writeFileSync(routes, JSON.stringify({ [withFile]: "null", [work]: JSON.stringify({ name: "File watch", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const api = async <T>(route: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + route, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    };
    const roster = () => api<{ bots: BotRecord[] }>("/api/bots?messages=0");
    const main = (await roster()).bots.find(bot => bot.defaultBot)!;
    const rows = async () => (await api<{ messages: Message[] }>(`/api/threads/${main.threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: withFile, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.role === "bot" && row.kind === "text" && row.text === "hello from fake claude"), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => !(await roster()).bots.find(bot => bot.id === main.id)?.busy, { timeout: 15000 }).toBe(true);
    const before = (await roster()).bots.length;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: work, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer?.contextBlock === "files"), { timeout: 20000 }).toBe(true);
    const blocked = (await rows()).find(row => row.card?.teamSetupRequest?.workBotOffer?.contextBlock === "files")!.card!;
    const refused = await fetch(`${base}/api/threads/${main.threadId}/respond`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ requestId: blocked.requestId, behavior: "allow" }) });
    expect(refused.status).toBe(409);
    await api(`/api/threads/${main.threadId}/respond`, { requestId: blocked.requestId, behavior: "deny" });
    await expect.poll(async () => {
      const messages = await rows();
      const index = messages.findIndex(row => row.text === work);
      return index >= 0 && messages.slice(index + 1).some(row => row.role === "bot" && row.kind === "text") && !(await roster()).bots.find(bot => bot.id === main.id)?.busy;
    }, { timeout: 20000 }).toBe(true);
    expect((await rows()).find(row => row.card?.requestId === blocked.requestId)?.card?.answered).toBe("deny");
    expect((await roster()).bots).toHaveLength(before);
    expect(readFileSync(prompts, "utf8").trim().split("\n").map(line => JSON.parse(line) as unknown).filter(prompt => JSON.stringify(prompt).includes(work))).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toBe("synthetic fixture only");
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it("does not offer a dedicated bot after a Data-context request has already run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-direct-data-"));
  const routes = join(dir, "routes.json");
  const textLog = join(dir, "text-log.jsonl");
  const text = "Follow this synthetic Data report weekly";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Data report", icon: "chart" }) }));
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_TEXT_LOG: textLog, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const api = async <T>(route: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + route, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    };
    const main = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.defaultBot)!;
    const rows = async () => (await api<{ messages: Message[] }>(`/api/threads/${main.threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, dataContext: { cardId: "c_42" }, sendId: randomUUID() });
    await expect.poll(async () => (await rows()).some(row => row.role === "bot" && row.kind === "text" && row.text === "hello from fake claude"), { timeout: 15000 }).toBe(true);
    expect((await rows()).some(row => row.card?.teamSetupRequest?.workBotOffer)).toBe(false);
    expect(existsSync(textLog) ? readFileSync(textLog, "utf8") : "").not.toContain(text);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it.each([["allow", "button"], ["deny", "button"], ["allow", "typed"], ["deny", "typed"]])("stops the %s run using %s from the original conversation without resuming its old session", async (behavior, method) => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-stop-target-"));
  const routes = join(dir, "routes.json");
  const finishGate = join(dir, "finish"), prompts = join(dir, "prompts.jsonl");
  const text = "Monitor the synthetic stock each week";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Stock watch", icon: "box" }) }));
  const token = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate, FAKE_CLAUDE_PROMPTS: prompts, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    };
    const main = (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.defaultBot)!;
    const rows = async (threadId: string) => (await api<{ messages: Message[] }>(`/api/threads/${threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const offer = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const response = await api<{ result: { bots: Array<{ id: string }> } }>(`/api/threads/${main.threadId}/respond`, { requestId: offer.requestId, behavior });
    const worker = behavior === "deny" ? main : (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.id === response.result.bots[0]?.id)!;
    await expect.poll(async () => (await rows(worker.threadId)).some(row => row.role === "user" && row.text === text), { timeout: 15000 }).toBe(true);
    await expect.poll(() => existsSync(prompts) && readFileSync(prompts, "utf8").includes(text), { timeout: 15000 }).toBe(true);
    await expect.poll(() => {
      const saved = JSON.parse(readFileSync(join(fixture!.info.dataDir, "bots.json"), "utf8")) as BotRecord[];
      return Boolean(saved.find(bot => bot.id === worker.id)?.tasks?.find(task => task.threadId === worker.threadId)?.resumeCursors?.claude);
    }, { timeout: 15000 }).toBe(true);
    if (method === "typed") await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: "stop", sendId: randomUUID() });
    else await api(`/api/bots/${main.id}/interrupt`, { threadId: main.threadId });
    await expect.poll(async () => (await rows(worker.threadId)).find(row => row.role === "user" && row.text === text)?.requestCancelled, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => !(await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots.find(bot => bot.id === worker.id)?.busy, { timeout: 15000 }).toBe(true);
    if (method === "typed") {
      expect((await rows(main.threadId)).filter(row => row.role === "user" && row.text === "stop")).toHaveLength(1);
      expect(readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean)).toHaveLength(1);
    }
    const later = "A different synthetic request";
    await api(`/api/bots/${worker.id}/messages`, { threadId: worker.threadId, text: later, sendId: randomUUID() });
    await expect.poll(async () => (await rows(worker.threadId)).find(row => row.text === later)?.requestPending, { timeout: 15000 }).toBe(true);
    await expect.poll(() => existsSync(fixture!.fixtureDumpPath) && JSON.stringify(JSON.parse(readFileSync(fixture!.fixtureDumpPath, "utf8")).prompt).includes(later), { timeout: 15000 }).toBe(true);
    const resumed = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { argv: string[]; prompt: unknown };
    expect(resumed.argv).not.toContain("--resume");
    expect(JSON.stringify(resumed.prompt)).not.toContain(text);
    expect(JSON.stringify(resumed.prompt)).toContain("This earlier request was stopped");
    await api(`/api/bots/${main.id}/interrupt`, { threadId: main.threadId });
    expect(Boolean((await rows(worker.threadId)).find(row => row.text === later)?.requestCancelled)).toBe(behavior === "deny");
  } finally {
    globalThis.fetch = originalFetch;
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it("keeps the existing provider session for ordinary turns without a stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-session-reuse-"));
  const routes = join(dir, "routes.json"), first = "FIRST_SYNTHETIC_HELLO", second = "SECOND_SYNTHETIC_HELLO";
  writeFileSync(routes, JSON.stringify({ [first]: "null", [second]: "null" }));
  const token = randomBytes(32).toString("base64url"), originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, OMB_TEST_DESKTOP_OWNER_TOKEN: token });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown): Promise<T> => { const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); const value = await response.json(); expect(response.ok, JSON.stringify(value)).toBe(true); return value as T; };
    const bots = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const main = (await bots()).find(bot => bot.defaultBot)!;
    const rows = async () => (await api<{ messages: Message[] }>(`/api/threads/${main.threadId}/messages`)).messages;
    const send = (text: string) => api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    const dump = () => JSON.parse(readFileSync(fixture!.fixtureDumpPath, "utf8")) as { pid: number; argv: string[]; prompt: unknown };
    await send(first);
    await expect.poll(async () => (await rows()).some(row => row.role === "user" && row.text === first && row.requestPending === false), { timeout: 20000 }).toBe(true);
    const initial = dump();
    await send(second);
    await expect.poll(() => JSON.stringify(dump().prompt).includes(second), { timeout: 20000 }).toBe(true);
    const continued = dump();
    expect(continued.pid === initial.pid || continued.argv.includes("--resume")).toBe(true);
    expect(JSON.stringify(continued.prompt)).not.toContain(first);
  } finally {
    globalThis.fetch = originalFetch; await fixture?.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
