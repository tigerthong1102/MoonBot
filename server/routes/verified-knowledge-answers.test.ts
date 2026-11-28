import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { Store } from "../store.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import type { SideJobText } from "../side-jobs.ts";
import { deferred } from "../testing/deferred.ts";
import { createKnowledgeAnswers, type KnowledgeAnswerDeps } from "./knowledge-answers.ts";

const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"], desktopOwner: true };
const result = JSON.stringify({ paragraphs: [{ text: "The approved period is 30 days.", sources: [1] }] });

function fixture() {
  const store = new Store(() => ({ instanceId: "fixture", model: "fixture-model" }));
  const bot = store.createBot({ name: "Fixture" }), other = store.createBot({ name: "Other" });
  const source = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Approved period: 30 days." });
  const outsider = store.appendMessage(other.threadId, { role: "user", kind: "text", text: "Private second conversation." });
  let allowed = true, writerEnabled = true, providerIdentity = {};
  const generate = vi.fn<SideJobText["generateText"]>(async (_prompt, options) => { options?.started?.(); return result; });
  const route = createKnowledgeAnswers({ store, accessible: () => allowed, unavailable: () => null, busy: () => false,
    refusal: () => null, sender: () => undefined, contextChanged: () => {}, providerIdentity: () => providerIdentity,
    writer: () => writerEnabled ? ({ via: "engine", selection: { instanceId: "fixture", model: "fixture-model" }, generateText: generate }) : null,
  } satisfies KnowledgeAnswerDeps);
  const path = `/api/bots/${bot.id}/knowledge-answers/verified`;
  const body = { threadId: bot.threadId, question: "What is the period?", messages: [{ id: source.id, expectedSha256: createHash("sha256").update(source.text!).digest("hex") }],
    allowProvider: true, provider: { instanceId: "fixture", model: "fixture-model" } };
  function send(overrides: Record<string, unknown> = {}, actor: RequestAuth = auth) {
    const req = new IncomingMessage(new Socket()), res = new ServerResponse(req);
    let status = 0, answer: unknown;
    const done = route({ req, res, path, url: new URL(path, "http://localhost"), method: "POST", auth: actor,
      readBody: async () => ({ ...body, ...overrides }), json: (_res, code, value) => { status = code; answer = value; },
    }).then(() => ({ status, answer }));
    return { done, disconnect: () => res.emit("close") };
  }
  return { store, bot, source, outsider, generate, send, setAllowed: (next: boolean) => { allowed = next; }, setWriter: (next: boolean) => { writerEnabled = next; }, replaceProvider: () => { providerIdentity = {}; } };
}

it("answers from selected server messages and rejects client-supplied text, cross-thread IDs and missing consent", async () => {
  const f = fixture();
  expect(requiredScope("POST", `/api/bots/${f.bot.id}/knowledge-answers/verified`)).toBe("admin");
  expect((await f.send({ evidence: [{ text: "forged" }] }).done).status).toBe(400);
  expect((await f.send({ messages: [{ id: f.outsider.id, expectedSha256: createHash("sha256").update(f.outsider.text!).digest("hex") }] }).done).status).toBe(404);
  expect((await f.send({ messages: [{ id: f.source.id, expectedSha256: "a".repeat(64) }] }).done).status).toBe(404);
  expect((await f.send({ messages: Array(2).fill({ id: f.source.id, expectedSha256: createHash("sha256").update(f.source.text!).digest("hex") }) }).done).status).toBe(400);
  expect((await f.send({ allowProvider: false }).done).status).toBe(400);
  expect((await f.send({ provider: { instanceId: "other", model: "fixture-model" } }).done).status).toBe(409);
  expect(f.generate).not.toHaveBeenCalled();
  const accepted = await f.send().done;
  expect(accepted).toEqual({ status: 200, answer: { paragraphs: [{ text: "The approved period is 30 days.", sources: [1] }],
    sources: [{ messageId: f.source.id, digest: createHash("sha256").update(f.source.text!).digest("hex") }] } });
  const prompt = f.generate.mock.calls[0]![0];
  expect(prompt).toContain("Approved period: 30 days.");
  expect(prompt).not.toContain("Private second conversation.");
});

it("withholds the response if permissions are revoked while the provider is working", async () => {
  const f = fixture(), waiting = deferred<void>(), resume = deferred<void>();
  f.generate.mockImplementationOnce(async (_prompt, options) => { options?.started?.(); waiting.resolve(); await resume.promise; return result; });
  const pending = f.send(); await waiting.promise; f.setAllowed(false); resume.resolve();
  const refused = await pending.done;
  expect(refused).toEqual({ status: 409, answer: { error: "source_changed" } });
});

it("withholds the response if the provider becomes unavailable while working", async () => {
  const f = fixture(), waiting = deferred<void>(), resume = deferred<void>();
  f.generate.mockImplementationOnce(async (_prompt, options) => { options?.started?.(); waiting.resolve(); await resume.promise; return result; });
  const pending = f.send(); await waiting.promise; f.setWriter(false); resume.resolve();
  expect((await pending.done).status).toBe(409);
});

it("rejects invalid source indexes from the provider", async () => {
  const f = fixture();
  f.generate.mockImplementationOnce(async (_prompt, options) => { options?.started?.(); return JSON.stringify({ paragraphs: [{ text: "Unsupported", sources: [2] }] }); });
  expect((await f.send().done).status).toBe(502);
});

it("rejects uncited paragraphs and oversized model output", async () => {
  const f = fixture();
  for (const raw of [JSON.stringify({ paragraphs: [{ text: "Unsupported", sources: [] }] }), "x".repeat(64_001)]) {
    f.generate.mockImplementationOnce(async (_prompt, options) => { options?.started?.(); return raw; });
    expect(await f.send().done).toEqual({ status: 502, answer: { error: "invalid_source_answer" } });
  }
});

it("withholds recognizable credentials from provider requests and masks them in responses", async () => {
  const f = fixture(), secret = "sk-" + "x".repeat(24);
  expect((await f.send({ question: `What is ${secret}?` }).done).status).toBe(400);
  f.source.text = `API key: ${secret}`;
  const digest = createHash("sha256").update(f.source.text).digest("hex");
  expect((await f.send({ messages: [{ id: f.source.id, expectedSha256: digest }] }).done).status).toBe(404);
  expect(f.generate).not.toHaveBeenCalled();
  f.source.text = "Approved period: 30 days.";
  f.generate.mockImplementationOnce(async (_prompt, options) => { options?.started?.(); return JSON.stringify({ paragraphs: [{ text: secret, sources: [1] }] }); });
  const received = await f.send().done;
  expect(received.status).toBe(200);
  expect(JSON.stringify(received.answer)).not.toContain(secret);
});

it("denies sessions, ordinary loopback, companion and service callers", async () => {
  const f = fixture();
  const session: RequestAuth = { kind: "session", via: "cookie", scopes: ["admin", "client"], session: {
    id: "viewer", label: "Viewer", email: "viewer@example.test", scopes: ["admin", "client"], tokenHash: "", createdAt: 0, lastSeenAt: 0, expiresAt: Infinity,
  } };
  for (const actor of [session, { kind: "loopback", scopes: ["admin", "client"] },
    { kind: "loopback", scopes: ["admin", "client"], desktopOwner: true, companionDevice: "phone" },
    { kind: "loopback", scopes: ["client"], trust: "service" }] as RequestAuth[]) {
    expect((await f.send({}, actor).done).status).toBe(404);
  }
  expect(f.generate).not.toHaveBeenCalled();
});

it.each(["permission", "source", "provider configuration"]) ("refuses %s changes before the queued provider starts", async (changed) => {
  const f = fixture(), waiting = deferred<void>(), resume = deferred<void>();
  const transmitted: string[] = [];
  f.generate.mockImplementationOnce(async (prompt, options) => { waiting.resolve(); await resume.promise; options?.started?.(); transmitted.push(prompt); return result; });
  const pending = f.send(); await waiting.promise;
  if (changed === "permission") f.setAllowed(false);
  else if (changed === "source") f.source.text = "Revised source.";
  else f.replaceProvider();
  resume.resolve();
  expect((await pending.done).status).toBe(409);
  expect(transmitted).toEqual([]);
});

it("withholds the response after the provider configuration changes during generation", async () => {
  const f = fixture(), waiting = deferred<void>(), resume = deferred<void>();
  f.generate.mockImplementationOnce(async (_prompt, options) => { options?.started?.(); waiting.resolve(); await resume.promise; return result; });
  const pending = f.send(); await waiting.promise; f.replaceProvider(); resume.resolve();
  expect((await pending.done).status).toBe(409);
});

it("does not return an answer when an authorized source changes while the model is running", async () => {
  const f = fixture(), waiting = deferred<void>(), resume = deferred<void>();
  f.generate.mockImplementationOnce(async (_prompt, options) => { options?.started?.(); waiting.resolve(); await resume.promise; return result; });
  const pending = f.send(); await waiting.promise; f.source.text = "Changed after provider start."; resume.resolve();
  expect((await pending.done).status).toBe(409);
});
