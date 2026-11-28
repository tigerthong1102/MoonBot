import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { ProviderInstance } from "../contracts.ts";
import { Store } from "../store.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { KnowledgeAnswerDeps } from "./knowledge-answers.ts";
import type { SideJobText } from "../side-jobs.ts";
import { createZaloModelAnalysis } from "./zalo-model-analysis.ts";
import type { ZaloModelOffer } from "../../shared/zalo-model-analysis.ts";

const owner: RequestAuth = { kind: "loopback", scopes: ["admin"], desktopOwner: true };
const source = "Nhờ xuất hóa đơn tháng 11";
const finding = { kind: "invoice", line: 7, quote: "xuất hóa đơn" };
function fixture() {
  let target = { displayName: "Fixture-local", instanceId: "local" } as ProviderInstance;
  const selection = { instanceId: "local", model: "fixture" };
  const store = new Store(() => selection);
  const bot = store.createBot({ name: "Thu" });
  const accessible = vi.fn(() => true);
  const refusal = vi.fn<(bot: string, thread: string, admit?: boolean) => ReturnType<KnowledgeAnswerDeps["refusal"]>>(() => null);
  const generate = vi.fn<SideJobText["generateText"]>(async (_prompt, options) => {
    options?.started?.(); options?.beforeRequest?.(); return JSON.stringify({ findings: [finding] });
  });
  const writer = vi.fn<KnowledgeAnswerDeps["writer"]>(() => ({ via: "engine", selection, generateText: generate }));
  const route = createZaloModelAnalysis({ store, accessible, refusal, unavailable: () => null, busy: () => false, writer }, true, () => target);
  const path = "/api/bots/" + bot.id + "/zalo-model-analysis", url = new URL(path, "http://fixture");
  url.searchParams.set("thread", bot.threadId);
  async function call(method: string, input: unknown = {}, auth = owner) {
    const req = new IncomingMessage(new Socket()), res = new ServerResponse(req);
    req.headers["content-type"] = "application/json";
    let status = 0, data: unknown = null;
    await route({ path, url, req, res, method, auth, readBody: async () => structuredClone(input),
      json: (_res, code, value) => { status = code; data = value; } });
    return { status, data };
  }
  const prepare = async () => ((await call("GET")).data as ZaloModelOffer).token;
  const run = (token: string, patch = {}) => call("POST", {
    token, consent: true, recipe: "accounting", conversation: "group", lines: [{ line: 7, text: source }], ...patch,
  });
  return { call, prepare, run, store, bot, generate, writer, accessible, refusal, selection, replace: () => { target = { ...target }; } };
}

describe("manual Zalo analysis with the selected bot", () => {
  it("sends only chosen source lines and returns validated, deduplicated citations without creating a chat message", async () => {
    const f = fixture(), token = await f.prepare();
    const history = [...f.store.activePath(f.bot.threadId)];
    f.generate.mockResolvedValue(JSON.stringify({ findings: [finding, finding] }));
    expect(await f.run(token)).toEqual({ status: 200, data: { findings: [finding] } });
    expect(f.generate.mock.calls[0]![0]).toContain(JSON.stringify({ line: 7, text: source }));
    expect(f.generate.mock.calls[0]![0]).toContain('"conversation":"group"');
    expect(f.store.activePath(f.bot.threadId)).toEqual(history);
    expect((await f.run(token)).status).toBe(409);
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it.each([{ ...finding, quote: "đã thanh toán" }, { ...finding, line: 1 }, { ...finding, kind: "buy" }, { ...finding, note: "extra" }])(
    "rejects an invalid finding as a whole", async value => {
      const f = fixture();
      f.generate.mockResolvedValue(JSON.stringify({ findings: [finding, value] }));
      expect((await f.run(await f.prepare())).status).toBe(502);
    });
  it("requires a real owner, explicit consent and bounded unique source lines", async () => {
    const f = fixture();
    expect((await f.call("GET", {}, { kind: "loopback", scopes: ["admin"] })).status).toBe(403);
    const token = await f.prepare();
    for (const patch of [{ consent: false }, { lines: [{ line: 1, text: "a" }, { line: 1, text: "b" }] }, { lines: [{ line: 1, text: "x".repeat(8001) }] }]) {
      expect((await f.run(token, patch)).status).toBe(400);
    }
    expect(f.generate).not.toHaveBeenCalled();
  });
  it("withholds the provider offer for unsupported isolated text and checks cost admission before generation", async () => {
    const f = fixture();
    f.writer.mockReturnValueOnce(null);
    expect((await f.call("GET")).status).toBe(422);
    const token = await f.prepare();
    f.refusal.mockReturnValue({ status: 403, body: { code: "spend_limit" } });
    expect((await f.run(token)).status).toBe(422);
    expect(f.generate).not.toHaveBeenCalled();
  });
  it.each(["model", "instance", "revoke"] as const)("aborts a queued %s change before disclosure", async change => {
    const f = fixture(), dispatch = vi.fn();
    f.generate.mockImplementation(async (_prompt, options) => {
      if (change === "model") f.selection.model = "another";
      if (change === "instance") f.replace();
      if (change === "revoke") f.accessible.mockReturnValue(false);
      options?.beforeRequest?.();
      dispatch();
      return JSON.stringify({ findings: [] });
    });
    expect((await f.run(await f.prepare())).status).toBe(409);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("returns a paid result when its own charge reaches the admission cap", async () => {
    const f = fixture();
    f.generate.mockImplementation(async (_prompt, options) => {
      options?.beforeRequest?.();
      f.refusal.mockImplementation((_bot, _thread, admit) => admit ? { status: 409, body: { code: "spend_cap" } } : null);
      return JSON.stringify({ findings: [finding] });
    });
    expect(await f.run(await f.prepare())).toEqual({ status: 200, data: { findings: [finding] } });
    expect((await f.call("GET")).status).toBe(422);
  });
  it("rechecks source access before returning delayed output", async () => {
    const f = fixture();
    f.generate.mockImplementation(async () => { f.accessible.mockReturnValue(false); return JSON.stringify({ findings: [finding] }); });
    expect((await f.run(await f.prepare())).status).toBe(409);
  });
});

it("applies the existing bot budget and the private preview guard at provider request time", async () => {
  const { createSideJobs } = await import("../side-jobs.ts");
  const { createJobSlots } = await import("../job-slots.ts");
  const selection = { instanceId: "fixture-local", model: "fixture-model" };
  const before = vi.fn(), sent = vi.fn(), book = vi.fn();
  let allowance = true;
  const assertWithinBudget = vi.fn(() => { if (!allowance) throw Error("budget"); });
  const instance = { instanceId: selection.instanceId, driverKind: "openai-compat", enabled: true, models: { default: selection.model, options: [] },
    adapter: { capabilities: { agentsMcp: false } }, generateText: async (_prompt: string, options?: import("../contracts.ts").TextGenerationOptions) => {
      expect(options?.requireIsolatedText).toBe(true);
      options?.beforeRequest?.(); sent(); return "{}";
    } };
  const jobs = createSideJobs({ slots: createJobSlots(1), bot: id => ({ id, name: "Reader", threadId: "task", modelSelection: selection }),
    instance: () => instance, helper: () => null, refusal: () => undefined,
    smallModels: { refused: () => new Set(), remember: () => {} }, assertWithinBudget, book });
  const writer = jobs.sourceAnswer("reader", selection, "task", { kind: "user" })!;
  await writer.generateText("ok", { beforeRequest: before });
  expect(before).toHaveBeenCalledOnce();
  expect(assertWithinBudget).toHaveBeenCalledWith("reader");
  allowance = false;
  await expect(writer.generateText("blocked", { beforeRequest: before })).rejects.toThrow("budget");
  expect(sent).toHaveBeenCalledOnce();
});
