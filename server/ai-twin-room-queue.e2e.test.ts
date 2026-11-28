import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { AI_TWIN_DELEGATION_PATH, AI_TWIN_LESSONS_PATH, AI_TWIN_PATH, type AiTwinView } from "../shared/ai-twin.ts";

it("queues an approved Twin reply behind the room's turn, rejects steering, and cancels a revoked reply", async () => {
  const work = mkdtempSync(join(tmpdir(), "startupbot-twin-room-"));
  const gate = join(work, "finish");
  const prompts = join(work, "prompts");
  const token = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({
    OMB_TEST_DESKTOP_OWNER_TOKEN: token,
    FAKE_CLAUDE_MODE: "slow",
    FAKE_CLAUDE_SLOW_FINISH_GATE: gate,
    FAKE_CLAUDE_PROMPTS: prompts,
  });
  try {
    const request = (path: string, method = "GET", body?: unknown) => fetch(fixture.info.url + path, {
      method, headers: { "x-openmausbot-desktop-owner": token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const view = async (path: string, method = "GET", body?: unknown, status = 200) => {
      const response = await request(path, method, body);
      const data = await response.json();
      expect(response.status, JSON.stringify(data)).toBe(status);
      return data as AiTwinView;
    };
    const { creationEpoch } = await view(AI_TWIN_PATH);
    let current = await view(AI_TWIN_PATH, "POST", { name: "Fixture Twin", creationEpoch, creationId: randomUUID(), createConsent: true }, 201);
    const revisions = () => ({ id: current.twin!.id, revision: current.twin!.revision });
    const question = "When is the audited room release?";
    const answer = "Room release is Friday at noon.";
    const otherQuestion = "What is the private fallback plan?";
    const otherAnswer = "This revoked answer must not enter the channel.";
    for (const [q, a] of [[question, answer], [otherQuestion, otherAnswer]]) {
      current = await view(AI_TWIN_LESSONS_PATH, "POST", { ...revisions(), question: q, answer: a, saveAsLesson: true });
    }
    const createdBot = await request("/api/bots", "POST", { name: "Holding bot" });
    expect(createdBot.status).toBe(201);
    const { bot } = await createdBot.json() as { bot: { id: string } };
    const made = await request("/api/groups", "POST", { name: "Twin queue fixture", memberIds: [bot.id] });
    expect(made.status).toBe(201);
    const { group } = await made.json() as { group: { id: string; threadId: string } };
    const groupPath = `/api/groups/${group.id}`;
    expect((await request(`${groupPath}/setup`, "PATCH", {
      action: "complete", cwd: null, bulletin: "", defaultResponder: { kind: "member", botId: bot.id },
    })).status).toBe(200);
    for (const lesson of current.lessons!) {
      current = await view(AI_TWIN_DELEGATION_PATH, "PATCH", { ...revisions(), room: group.id, lesson: lesson.id, enabled: true });
    }
    const rows = async () => {
      const response = await request(`/api/threads/${group.threadId}/messages`);
      return (await response.json() as { messages: Array<{
        id: string; role: string; text?: string; from?: { name: string }; queueId?: string; replyToId?: string;
      }> }).messages;
    };
    const startedPrompts = () => existsSync(prompts) ? readFileSync(prompts, "utf8") : "";
    const send = (text: string, sendId = randomUUID()) => request(`${groupPath}/messages`, "POST", { text, sendId, threadId: group.threadId });
    async function hold(text: string) {
      expect((await send(text)).status).toBe(202);
      await expect.poll(() => startedPrompts().includes(text), { timeout: 15_000 }).toBe(true);
    }

    await hold("Hold the room before the first queued Twin reply");
    const twinSendId = randomUUID();
    const queued = await send(`@AI Twin ${question}`, twinSendId);
    expect(queued.status).toBe(202);
    const ticket = await queued.json() as { queued: boolean; queueId: string };
    expect(ticket).toMatchObject({ queued: true, queueId: expect.any(String) });
    const journal = new DatabaseSync(join(fixture.info.dataDir, "messages.db"), { readOnly: true });
    try {
      const stored = journal.prepare("SELECT payload FROM chat_followups WHERE id = ? AND status = 'pending'").get(ticket.queueId) as { payload: string };
      expect(JSON.parse(stored.payload)).toMatchObject({
        twinReply: { twinId: current.twin!.id, revision: current.twin!.revision, actor: { kind: "desktop" } },
      });
      expect(stored.payload).not.toContain(answer);
    } finally { journal.close(); }
    expect(await (await send(`@AI Twin ${question}`, twinSendId)).json()).toMatchObject(ticket);
    const steering = await request(`${groupPath}/queue/${ticket.queueId}/steer`, "POST", { threadId: group.threadId });
    expect(steering.status).toBe(200);
    expect(await steering.json()).toMatchObject({ queued: true });
    expect((await rows()).some((row) => row.text?.includes(question))).toBe(false);
    writeFileSync(gate, "finish");
    await expect.poll(async () => (await rows()).filter((row) => row.from?.name === "AI Twin").length, { timeout: 15_000 }).toBe(1);
    const published = await rows();
    const ask = published.find((row) => row.queueId === ticket.queueId)!;
    expect(ask).toMatchObject({ role: "user", text: `@AI Twin ${question}` });
    expect(published).toContainEqual(expect.objectContaining({ from: expect.objectContaining({ name: "AI Twin" }), replyToId: ask.id, text: answer }));
    expect(await (await send(`@AI Twin ${question}`, twinSendId)).json()).toMatchObject({ message: { id: ask.id } });

    rmSync(gate);
    await hold("Hold the room before the revoked Twin reply");
    const revokedSendId = randomUUID();
    const pending = await send(`@AI Twin ${otherQuestion}`, revokedSendId);
    expect(pending.status).toBe(202);
    expect(await pending.json()).toMatchObject({ queued: true, queueId: expect.any(String) });
    await view(AI_TWIN_DELEGATION_PATH, "PATCH", {
      ...revisions(), room: group.id, lesson: current.lessons!.find((lesson) => lesson.question === otherQuestion)!.id, enabled: false,
    });
    writeFileSync(gate, "finish");
    await expect.poll(async () => (await send(`@AI Twin ${otherQuestion}`, revokedSendId)).status, { timeout: 15_000 }).toBe(409);
    const after = await rows();
    expect(after.filter((row) => row.from?.name === "AI Twin")).toHaveLength(1);
    expect(after.some((row) => row.text?.includes(otherQuestion) || row.text === otherAnswer)).toBe(false);
    expect(startedPrompts()).not.toContain(otherQuestion);
  } finally {
    await fixture.close();
    rmSync(work, { recursive: true, force: true });
  }
}, 90_000);
