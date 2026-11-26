import { deferred } from "../testing/deferred.ts";
import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import { Store } from "../store.ts";
import type { SideJobText } from "../side-jobs.ts";
import { createKnowledgeAnswers } from "./knowledge-answers.ts";

function member(id: string, email: string): RequestAuth {
  return { kind: "session", via: "cookie", scopes: ["client"], session: {
    id, email, scopes: ["client"], tokenHash: "", label: "Reader", createdAt: 0, lastSeenAt: 0, expiresAt: Infinity,
  } };
}
const response = JSON.stringify({ paragraphs: [{ text: "Answer", sources: [1] }] });

function fixture() {
  const store = new Store(() => ({ instanceId: "codex", model: "selected" }));
  const bot = store.createBot({ name: "Reader" }), otherBot = store.createBot({ name: "Other" });
  const threads = [bot.threadId, store.createTask(bot.id, "Another conversation")!.threadId, otherBot.threadId];
  const accessible = vi.fn(() => true);
  const generate = vi.fn<SideJobText["generateText"]>().mockResolvedValue(response);
  const route = createKnowledgeAnswers({ store, accessible, busy: () => false, refusal: () => null, sender: () => undefined,
    writer: () => ({ via: "engine", generateText: generate }) });
  function send(auth: RequestAuth, thread: number, id = randomUUID()) {
    const req = new IncomingMessage(new Socket()), res = new ServerResponse(req);
    const path = "/api/bots/" + (thread === 2 ? otherBot.id : bot.id) + "/knowledge-answers";
    let status: number | undefined;
    const done = route({ auth, req, res, url: new URL(path, "http://localhost"), path, method: "POST",
      readBody: async () => ({ question: "Question", threadId: threads[thread], sendId: id,
        evidence: [{ path: "guide", digest: "a".repeat(64), start: 0, page: 1, paragraph: 1, text: "Source" }] }),
      json: (_res, code) => { status = code; },
    }).then(() => status);
    return { done, disconnect: () => res.emit("close") };
  }
  return { send, accessible, generate };
}

it("admits one source request per person across sessions, bots and threads, and frees it on every exit", async () => {
  const { send, generate, accessible } = fixture();
  const phone = member("phone", "Reader@example.test"), desktop = member("desktop", "reader@EXAMPLE.test");
  const colleague = member("other", "other@example.test");
  const queued = deferred<void>(), proceed = deferred<void>();
  generate.mockImplementationOnce(async (_prompt, opts) => {
    queued.resolve(); await proceed.promise; opts?.started?.(); return response;
  });
  const id = randomUUID(), first = send(phone, 0, id);
  await queued.promise;
  expect(await send(desktop, 0).done).toBe(409);
  expect(await send(desktop, 1).done).toBe(429);
  expect(await send(desktop, 2).done).toBe(429);
  expect(await send(colleague, 2).done).toBe(200);

  accessible.mockReturnValue(false); proceed.resolve();
  expect(await first.done).toBe(404);
  accessible.mockReturnValue(true);

  const started = deferred<void>();
  generate.mockImplementationOnce(async (_prompt, opts) => {
    opts?.started?.(); started.resolve();
    return new Promise((_resolve, reject) => opts!.signal!.addEventListener("abort", () => reject(new Error("closed")), { once: true }));
  });
  const interrupted = send(desktop, 1);
  await started.promise; interrupted.disconnect();
  expect(await interrupted.done).toBeUndefined();
  generate.mockRejectedValueOnce(new Error("provider failed"));
  expect(await send(phone, 1).done).toBe(502);
  expect(await send(phone, 0, id).done).toBe(200);
  const calls = generate.mock.calls.length;
  expect(await send(desktop, 0, id).done).toBe(200);
  expect(generate).toHaveBeenCalledTimes(calls);
});
