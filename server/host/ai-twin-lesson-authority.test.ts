import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { AI_TWIN_PATH, type AiTwinLesson, type AiTwinLearningExample, type AiTwinView } from "../../shared/ai-twin.ts";
import { createAiTwinStore } from "../ai-twin.ts";
import { json, readBody } from "../harness/http.ts";
import { Store } from "../store.ts";
import { createAiTwinHost } from "./ai-twin.ts";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "twin-sources-"));
  onTestFinished(() => rmSync(dir, { force: true, recursive: true }));
  const store = new Store(() => ({ instanceId: "fixture", model: "fixture" }));
  const bot = store.createBot({ name: "Fixture" }), thread = bot.threadId;
  const q = store.appendMessage(thread, { role: "user", kind: "text", text: "When are units inspected?" });
  const a = store.appendMessage(thread, { role: "user", kind: "text", text: "Every third Tuesday afternoon.", replyToId: q.id });
  const disk = createAiTwinStore(dir, "fixture");
  const twin = disk.create({ name: "Fixture", creationEpoch: "initial", creationId: randomUUID(), createConsent: true }).view.twin!;
  disk.setLearning({ id: twin.id, revision: twin.revision, thread, enabled: true });
  const policy = { source: true, visible: true, mayLearn: true, phone: false };
  const writer = vi.fn(async (_prompt: string) => "Synthetic preview.");
  const instance = { driverKind: "claudeAgent", instanceId: "fixture", enabled: true, models: { default: "fixture", options: [] }, adapter: { capabilities: { agentsMcp: false } } };
  const host = createAiTwinHost({
    enabled: true, desktop: true, dataDir: dir, workspace: "fixture", store,
    preview: { selection: () => ({ instanceId: "fixture", model: "fixture" }), jobs: { twinPreview: () => ({ name: "Fixture", instance, generateText: writer }) } },
    blocked: () => false, liveSession: () => false, sessionRecord: () => null,
    visible: () => ({ bot: () => policy.visible, thread: () => policy.visible, group: () => true }),
    ownerThread: () => policy.source, ownerLine: () => true, mayLearn: () => policy.mayLearn,
    roomReady: () => true, roomSendRefused: () => null, sender: () => undefined,
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    void host.routes({ req, res, url, path: url.pathname, method: req.method!, json, readBody,
      auth: policy.phone ? { kind: "loopback", scopes: ["admin"], companionDevice: "fixture" } : { kind: "loopback", desktopOwner: true, scopes: ["admin"] },
    }).catch(() => res.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const origin = `http://127.0.0.1:${address.port}`;
  async function call(path = "", body?: object, method = body ? "POST" : "GET") {
    const response = await fetch(origin + AI_TWIN_PATH + path, {
      method, headers: { "content-type": "application/json" }, ...(body && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() as AiTwinView & { lessons: AiTwinLesson[]; examples: AiTwinLearningExample[]; lesson: AiTwinLesson | null } };
  }
  const version = () => ({ id: twin.id, revision: disk.get().twin!.revision });
  const candidate = (await call("/learning")).data.examples[0]!;
  const approved = { ...version(), saveAsLesson: true, allowProvider: true, question: "When do we inspect units?", answer: "On the third Tuesday.", example: { thread, message: a.id, digest: candidate.digest } };
  return { store, disk, dir, writer, policy, call, version, approved, thread, q, a, bot, host };
}

it("binds both reviewed messages independently of edited lesson text and later acquisition choices", async () => {
  const f = await fixture();
  expect((await f.call("/lessons", { ...f.approved, example: { thread: f.thread, message: f.a.id } })).status).toBe(409);
  const saved = await f.call("/lessons", f.approved);
  expect(saved.data.lessons[0]).toMatchObject({ origin: "conversation", answer: f.approved.answer });
  expect(JSON.stringify(saved.data.lessons)).not.toContain(f.q.id);
  const lesson = saved.data.lessons[0]!.id;
  expect((await f.call("/learning", { ...f.version(), thread: f.thread, enabled: false }, "PATCH")).status).toBe(200);
  expect((await f.call("/lookup", { ...f.version(), question: f.approved.question })).data.lesson?.id).toBe(lesson);
  expect((await f.call("/inbox-exact-lessons")).data.lessons).toEqual([]);
  expect(() => f.disk.setDelegation({ ...f.version(), room: "private-room", lesson, enabled: true })).toThrow();
  await f.call("/phone", { ...f.version(), enabled: true }, "PATCH");
  f.policy.phone = true;
  expect((await f.call("/lookup", { ...f.version(), question: f.approved.question })).data.lesson?.id).toBe(lesson);
  f.policy.source = false;
  expect((await f.call("/lookup", { ...f.version(), question: f.approved.question })).data.lesson).toBeNull();
  f.policy.phone = false;
  expect((await f.call()).data.unavailableLessonIds).toEqual([lesson]);
  expect(JSON.stringify((await f.call()).data)).not.toContain(f.approved.answer);
  const manual = await f.call("/lessons", { ...f.version(), saveAsLesson: true, question: f.approved.question, answer: "Manual replacement." });
  expect(manual.status).toBe(200);
  expect((await f.call("/inbox-exact-lessons")).data.lessons.map((entry: { answer: string }) => entry.answer)).toEqual(["Manual replacement."]);
  f.policy.source = true;
  expect((await f.call("/lookup", { ...f.version(), question: f.approved.question })).data.lesson).toBeNull();
});

it("rejects a proposal if its parent changed before approval, even when the edited Q&A still fits", async () => {
  const f = await fixture();
  f.store.patchMessage(f.thread, f.q.id, { text: "When are shipments inspected?" });
  const current = (await f.call("/learning")).data.examples[0]!;
  expect(current.message).toBe(f.a.id);
  expect(current.digest).not.toBe(f.approved.example.digest);
  expect((await f.call("/lessons", f.approved)).status).toBe(409);
  expect((await f.call("/lessons", { ...f.approved, example: { ...f.approved.example, digest: current.digest } })).status).toBe(200);
});

it("retains approved evidence beyond the rolling list of twelve suggestions", async () => {
  const f = await fixture();
  expect((await f.call("/lessons", f.approved)).status).toBe(200);
  for (let i = 0; i < 15; i++) f.store.appendMessage(f.thread, { role: "user", kind: "text", text: `Q: What is fixture step ${i}?\nA: The owner describes fixture step ${i}.` });
  expect((await f.call("/learning")).data.examples.some(example => example.message === f.a.id)).toBe(false);
  expect((await f.call("/lookup", { ...f.version(), question: f.approved.question })).data.lesson?.answer).toBe(f.approved.answer);
});

it.each(["question", "answer", "hold", "clear"])("discards an approved derivative on %s change, even after original evidence returns", async mode => {
  const f = await fixture();
  const approved = await f.call("/lessons", f.approved);
  expect(approved.status).toBe(200);
  if (mode === "clear") {
    f.store.clearTaskMessages(f.bot.id, f.thread);
    f.store.importTranscript(f.thread, [f.q, f.a], f.a.id, []);
  } else if (mode === "hold") {
    f.store.patchMessage(f.thread, f.q.id, { workBotReviewHold: true });
    f.store.patchMessage(f.thread, f.q.id, { workBotReviewHold: undefined });
  } else {
    const line = mode === "question" ? f.q : f.a;
    const text = line.text;
    f.store.patchMessage(f.thread, line.id, { text: "The approved source changed." });
    f.store.patchMessage(f.thread, line.id, { text });
  }
  expect((await f.call()).data.lessons).toEqual([]);
  expect((await f.call("/lookup", { ...f.version(), question: f.approved.question })).data.lesson).toBeNull();
  expect(readFileSync(join(f.dir, "ai-twin/profile.json"), "utf8")).not.toContain(f.approved.answer);
});

it.each(["semantic", "draft", "phone"])("rechecks the source after the first provider call for %s", async mode => {
  const f = await fixture();
  const view = (await f.call("/lessons", f.approved)).data as AiTwinView;
  if (mode === "phone") {
    expect((await f.call("/phone", { ...f.version(), enabled: true }, "PATCH")).status).toBe(200);
    f.policy.phone = true;
  }
  let started!: () => void, finish!: (reply: string) => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  f.writer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); }));
  const request = f.call(mode === "semantic" ? "/lookup" : "/preview", {
    ...f.version(), useProvider: true, key: view.preview!.key,
    ...(mode !== "semantic" ? { question: f.approved.question, useMemory: true } : { question: "How often do we inspect units?" }),
  });
  await running;
  if (mode === "phone") f.host.revokeDevice("fixture");
  else f.policy.visible = false;
  finish(mode === "semantic" ? "0" : "A now-unavailable private draft.");
  const response = await request;
  expect(response).toMatchObject({ status: 409, data: { error: "twin_changed" } });
  expect(f.writer).toHaveBeenCalledTimes(1);
});

it.each([undefined, "manual"])("quarantines version-one Q&A and old grants, even with an untrusted origin of %s", async origin => {
  const f = await fixture();
  const file = join(f.dir, "ai-twin/profile.json");
  const old = JSON.parse(readFileSync(file, "utf8"));
  const legacyId = randomUUID();
  old.schemaVersion = 1;
  old.twin.lessons = [{ id: legacyId, question: "Private legacy question?", answer: "Private legacy answer.", source: "owner", updatedAt: 1, allowProvider: true, origin }];
  old.twin.controls.delegations = [{ room: "fixture", lesson: legacyId }];
  const original = JSON.stringify(old);
  writeFileSync(file, original, { mode: 0o600 });
  for (let i = 0; i < 2; i++) {
    const reopened = createAiTwinStore(f.dir, "fixture");
    expect(reopened.get()).toMatchObject({ lessons: [], unavailableLessonIds: [legacyId], controls: { delegations: [] } });
    expect(reopened.roomReply("fixture", "Private legacy question?")).toBeUndefined();
  }
  expect((await f.call("/inbox-exact-lessons")).data.lessons).toEqual([]);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect((await f.call("/lessons", { ...f.version(), lessonId: legacyId }, "DELETE")).status).toBe(200);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ schemaVersion: 2, twin: { lessons: [] } });
});
