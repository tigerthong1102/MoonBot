import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { AI_TWIN_LEARNING_PATH, AI_TWIN_LESSONS_PATH, type AiTwinLearningView } from "../../shared/ai-twin.ts";
import { createAiTwinStore } from "../ai-twin.ts";
import { Store } from "../store.ts";
import { createAiTwinHost } from "./ai-twin.ts";

it("refuses to save a reviewed reply after its source question is held", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "twin-example-"));
  onTestFinished(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = new Store(() => ({ instanceId: "fixture", model: "fixture" }));
  const { threadId } = store.createBot({ name: "Fixture" });
  const q = store.appendMessage(threadId, { role: "user", kind: "text", text: "Who reviews inventory?" });
  const a = store.appendMessage(threadId, { role: "user", kind: "text", text: "The inventory team reviews it.", replyToId: q.id });
  const privateStore = createAiTwinStore(dataDir, "workspace");
  const { twin } = privateStore.create({ name: "Fixture", creationId: randomUUID(), creationEpoch: "initial", createConsent: true }).view;
  const current = privateStore.setLearning({ id: twin!.id, revision: twin!.revision, thread: threadId, enabled: true }).twin!;
  const host = createAiTwinHost({
    enabled: true, desktop: true, workspace: "workspace", dataDir, store,
    preview: { selection: () => ({ instanceId: "fixture", model: "fixture" }), jobs: { twinPreview: () => null } },
    blocked: () => false, visible: () => ({ bot: () => true, thread: () => true, group: () => false }),
    liveSession: () => false, sessionRecord: () => null, mayLearn: () => true, ownerThread: () => true,
    ownerLine: () => true, roomReady: () => false, roomSendRefused: () => null, sender: () => undefined,
  });
  async function call(path: string, body?: Record<string, unknown>) {
    const req = new IncomingMessage(new Socket()), res = new ServerResponse(req);
    req.headers["content-type"] = "application/json";
    let status = 0, payload: unknown;
    await host.routes({ req, res, url: new URL(path, "http://localhost"), path, method: body ? "POST" : "GET",
      auth: { kind: "loopback", desktopOwner: true, scopes: ["admin"] }, readBody: async () => body,
      json: (_res, code, data) => { status = code; payload = data; },
    });
    return { status, payload };
  }

  const view = await call(AI_TWIN_LEARNING_PATH);
  expect(view.status).toBe(200);
  const example = (view.payload as AiTwinLearningView).examples[0]!;
  expect(example).toMatchObject({ thread: threadId, message: a.id, question: q.text, text: a.text });
  store.patchMessage(threadId, q.id, { workBotReviewHold: true });
  expect((await call(AI_TWIN_LEARNING_PATH)).payload).toMatchObject({ examples: [] });
  const save = await call(AI_TWIN_LESSONS_PATH, { id: current.id, revision: current.revision,
    question: example.question, answer: example.text, example: { thread: threadId, message: a.id }, saveAsLesson: true, allowProvider: true });
  expect(save.status).toBe(409);
  expect(privateStore.get().lessons).toEqual([]);
});
