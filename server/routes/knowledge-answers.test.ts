import { deferred } from "../testing/deferred.ts";
import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import { Store } from "../store.ts";
import type { ModelSelection } from "../contracts.ts";
import { createJobSlots } from "../job-slots.ts";
import { createSideJobs, type SideJobText } from "../side-jobs.ts";
import { createKnowledgeAnswers, type KnowledgeAnswerDeps } from "./knowledge-answers.ts";

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
  const contextChanged = vi.fn<KnowledgeAnswerDeps["contextChanged"]>();
  const writer = vi.fn<KnowledgeAnswerDeps["writer"]>(() => ({ via: "engine", selection: { instanceId: "codex", model: "selected" }, generateText: generate }));
  const route = createKnowledgeAnswers({ store, accessible, busy: () => false, refusal: () => null, sender: () => undefined,
    contextChanged, writer });
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
  return { send, accessible, generate, writer, contextChanged };
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

it.each(["instanceId", "model", "effort", "variant"] as const)("refuses a changed %s before sending evidence to a queued provider", async field => {
  const { send, writer, contextChanged } = fixture();
  const slots = createJobSlots(1), release = deferred<void>();
  const busy = slots.run(() => release.promise);
  let selection: ModelSelection = { instanceId: "A", model: "one", effort: "low", variant: "one" };
  const dispatched: string[] = [];
  const jobs = createSideJobs({
    slots, bot: id => ({ id, name: "Reader", threadId: "chat", modelSelection: selection }),
    instance: instanceId => ({ instanceId, driverKind: "openai-compat", enabled: true, models: { default: "", options: [] },
      adapter: { capabilities: { agentsMcp: false } }, generateText: async prompt => { dispatched.push(instanceId + " " + prompt); return response; } }),
    helper: () => null, refusal: () => undefined, smallModels: { refused: () => new Set(), remember: () => {} },
    assertWithinBudget: () => {}, book: () => {},
  });
  writer.mockImplementation((_auth, bot, threadId) => jobs.sourceAnswer(bot.id, selection, threadId, { kind: "user" }));
  const reader = member("viewer", "reader@example.test"), id = randomUUID();
  const pending = send(reader, 0, id);
  await vi.waitFor(() => expect(slots.waiting).toBe(1));
  selection = { ...selection, [field]: field === "instanceId" ? "B" : field === "effort" ? "high" : "two" };
  release.resolve(); await busy;
  expect.soft(await pending.done).toBe(409);
  expect(dispatched).toEqual([]);
  expect(contextChanged).not.toHaveBeenCalled();
  expect(await send(reader, 0, id).done).toBe(200);
  expect(dispatched).toHaveLength(1);
  expect(dispatched[0]).toContain(selection.instanceId + " ");
  expect(dispatched[0]).toContain('"text":"Source"');
  expect(contextChanged).toHaveBeenCalledTimes(1);
  expect(await send(reader, 0, id).done).toBe(200);
  expect(contextChanged).toHaveBeenCalledTimes(1);
});
