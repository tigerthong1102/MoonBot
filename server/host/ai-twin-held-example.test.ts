import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { AI_TWIN_LEARNING_PATH, AI_TWIN_LESSONS_PATH, type AiTwinLearningView } from "../../shared/ai-twin.ts";
import { createAiTwinStore } from "../ai-twin.ts";
import { json, readBody } from "../harness/http.ts";
import { Store } from "../store.ts";
import { createAiTwinHost } from "./ai-twin.ts";

it.each(["held", "outside the current history"])("refuses to save a reviewed reply after its source question is %s", async state => {
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
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    void host.routes({ req, res, url, path: url.pathname, method: req.method!, json, readBody,
      auth: { kind: "loopback", desktopOwner: true, scopes: ["admin"] },
    }).catch(() => res.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const origin = `http://127.0.0.1:${address.port}`;
  async function call(path: string, body?: Record<string, unknown>) {
    const result = await fetch(origin + path, body ? {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    } : {});
    return { status: result.status, payload: await result.json() };
  }

  const view = await call(AI_TWIN_LEARNING_PATH);
  expect(view.status).toBe(200);
  const example = (view.payload as AiTwinLearningView).examples[0]!;
  expect(example).toMatchObject({ thread: threadId, message: a.id, question: q.text, text: a.text });
  store.patchMessage(threadId, q.id, { workBotReviewHold: true });
  if (state === "outside the current history") {
    const divider = { id: randomUUID(), at: a.at, parentId: q.id, role: "bot" as const, kind: "compaction" as const,
      compaction: { summary: "", firstKeptId: "", foldedThroughId: q.id, tokensBefore: 0, by: "person" as const, fresh: true as const } };
    store.importTranscript(threadId, [divider], a.id, [{ id: a.id, parentId: divider.id }]);
  }
  expect((await call(AI_TWIN_LEARNING_PATH)).payload).toMatchObject({ examples: [] });
  const save = await call(AI_TWIN_LESSONS_PATH, { id: current.id, revision: current.revision,
    question: example.question, answer: example.text, example: { thread: threadId, message: a.id }, saveAsLesson: true, allowProvider: true });
  expect(save.status).toBe(409);
  expect(privateStore.get().lessons).toEqual([]);
});
