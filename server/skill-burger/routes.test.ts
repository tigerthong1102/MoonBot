import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import type { RunMessage } from "../../shared/skill-burger/layers.ts";
import { json, readBody } from "../harness/http.ts";
import { setLibrarySkillEveryBot } from "../skill-library.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { createSkillBurgerRoutes, type SkillBurgerRouteDeps } from "./routes.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const call = (id: string, slug: string, args: unknown): RunMessage => ({
  id, role: "bot", kind: "activity", tool: { name: "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", ok: true, input: JSON.stringify({ tools: [{ tool_slug: slug, arguments: args }] }) },
});
const thread: RunMessage[] = [
  { id: "u1", role: "user", kind: "text", text: "Send the invoice to priya@example.com" },
  call("m1", "GMAIL_FETCH_EMAILS", { query: "invoice" }),
  call("m2", "GMAIL_SEND_EMAIL", { recipient_email: "priya@example.com", subject: "Invoice" }),
];

async function serve(extra: Partial<SkillBurgerRouteDeps> = {}, scopes: readonly string[] = ["admin"]) {
  let currentScopes = scopes;
  const root = mkdtempSync(join(tmpdir(), "burger-routes-"));
  const bot = `route-burger-${Math.random().toString(36).slice(2, 10)}`;
  const routes = [createSkillBurgerRoutes({
    messages: (threadId) => (threadId === "t1" ? thread : []),
    owns: (botId, threadId) => botId === bot && ["t1", "t2", "t4"].includes(threadId),
    sees: (_auth, threadId) => threadId !== "t2",
    botIds: () => [bot],
    root,
    ...extra,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: currentScopes.includes("admin") ? "loopback" : "session", scopes: currentScopes } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, init);
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  return { api, bot, root, as: (next: readonly string[]) => { currentScopes = next; } };
}

const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const names = async (api: Awaited<ReturnType<typeof serve>>["api"]) => (await api("/api/skill-burgers")).body.skills.map((skill: { name: string; everyChat: boolean }) => [skill.name, skill.everyChat]);

it("does not read conversations or saved workflows when the installation disables Skill Burger", async () => {
  const messages = vi.fn(() => thread);
  const { api, bot } = await serve({ available: () => false, messages });
  expect((await api("/api/skill-burgers")).status).toBe(404);
  expect((await api("/api/skill-burger-draft", send("POST", { botId: bot, threadId: "t1" }))).status).toBe(404);
  expect((await api("/api/skill-burgers", send("POST", { botId: bot, threadId: "t1" }))).status).toBe(404);
  expect(messages).not.toHaveBeenCalled();
});

it("saves a run to its bot, shares it with every chat and back, renames, undoes and puts a removal back", async () => {
  const { api, bot } = await serve();
  const saved = await api("/api/skill-burgers", send("POST", { botId: bot, threadId: "t1", summary: "Send the invoice" }));
  expect(saved.status).toBe(201);
  expect(saved.body.skill).toMatchObject({ name: "send-the-invoice", summary: "Send the invoice", everyChat: false, botId: bot, args: ["query", "recipient", "subject"] });
  expect(await names(api)).toEqual([["send-the-invoice", false]]);
  expect((await api(`/api/skill-burgers/send-the-invoice?botId=${bot}`)).body.text).toContain("tags: workflow");

  const shared = await api("/api/skill-burgers/send-the-invoice", send("PATCH", { everyChat: true, botId: bot, sha256: saved.body.skill.sha256 }));
  expect(shared.body.skill).toMatchObject({ everyChat: true, botId: bot });
  expect(await names(api)).toEqual([["send-the-invoice", true]]);
  expect((await api("/api/skill-burgers/send-the-invoice", send("PATCH", { everyChat: false }))).body.skill).toMatchObject({ everyChat: false });

  const renamed = await api("/api/skill-burgers/send-the-invoice", send("PATCH", { rename: "invoice-to-priya", botId: bot }));
  expect(renamed.body.skill).toMatchObject({ name: "invoice-to-priya" });
  const read = await api(`/api/skill-burgers/invoice-to-priya?botId=${bot}`);
  expect((await api(`/api/skill-burgers/invoice-to-priya?botId=${bot}&sha256=${"0".repeat(64)}`, { method: "DELETE" })).status).toBe(409);
  expect((await api(`/api/skill-burgers/invoice-to-priya?botId=${bot}&sha256=${renamed.body.skill.sha256}`, { method: "DELETE" })).body).toEqual({ removed: true });
  expect(await names(api)).toEqual([]);
  expect((await api("/api/skill-burgers", send("POST", { name: "invoice-to-priya", workflow: read.body.workflow, botId: bot }))).status).toBe(201);
  expect(await names(api)).toEqual([["invoice-to-priya", false]]);
});

it("refuses a conversation the person can't see or that isn't the bot's, and a run with nothing to save", async () => {
  const { api, bot } = await serve();
  expect((await api("/api/skill-burgers", send("POST", { botId: bot, threadId: "t2" }))).status).toBe(404);
  expect((await api("/api/skill-burgers", send("POST", { botId: "other", threadId: "t1" }))).status).toBe(404);
  expect((await api("/api/skill-burgers", send("POST", { botId: bot, threadId: "t3" }))).status).toBe(404);
  expect((await api("/api/skill-burgers", send("POST", { botId: bot, threadId: "t4" }))).status).toBe(422);
  expect((await api("/api/skill-burgers", send("POST", { name: "x", workflow: { version: 1 }, botId: bot }))).status).toBe(422);
  expect((await api("/api/skill-burgers", send("POST", { name: "x", workflow: {}, botId: "gone" }))).status).toBe(404);
});

it("lets a Team member save and remove a burger on a bot they can edit, and keeps every chat an admin's", async () => {
  let access: "none" | "view" | "chat" | "edit" = "edit";
  const { api, bot } = await serve({ levelOf: () => access }, ["client"]);
  const saved = await api("/api/skill-burgers", send("POST", { botId: bot, threadId: "t1", summary: "Send the invoice" }));
  expect(saved.status).toBe(201);
  const name = saved.body.skill.name as string;
  const shared = await api(`/api/skill-burgers/${name}`, send("PATCH", { everyChat: true, botId: bot }));
  expect(shared.status).toBe(403);
  expect(shared.body.error).toMatch(/Only an admin/);
  access = "chat";
  expect((await api("/api/skill-burgers", send("POST", { botId: bot, threadId: "t1" }))).status).toBe(403);
  expect((await api(`/api/skill-burgers/${name}?botId=${bot}`, { method: "DELETE" })).status).toBe(403);
  expect((await names(api)).map(([found]: [string]) => found)).toContain(name);
  access = "none";
  expect(await names(api)).toEqual([]);
  expect((await api(`/api/skill-burgers/${name}?botId=${bot}`)).status).toBe(404);
  access = "edit";
  expect((await api(`/api/skill-burgers/${name}?botId=${bot}`, { method: "DELETE" })).status).toBe(200);
});

it("shows workflow history only for conversations the viewer can read", async () => {
  const history = { list: vi.fn(() => [
    { run: "visible", name: "workflow", botId: "visible-bot", threadId: "t1", startedAt: 1, at: 1, status: "ok" as const, steps: [] },
    { run: "private", name: "workflow", botId: "visible-bot", threadId: "t2", startedAt: 1, at: 1, status: "ok" as const, steps: [] },
  ]) };
  const { api } = await serve({ history, levelOf: () => "view" }, ["client"]);
  const result = await api("/api/skill-burgers/workflow/runs");
  expect(result.status).toBe(200);
  expect(result.body.runs.map((entry: { run: string }) => entry.run)).toEqual(["visible"]);
});

it("does not let an admin bypass a private bot's access level", async () => {
  let level: "none" | "edit" = "edit";
  const h = await serve({ levelOf: () => level });
  const saved = await h.api("/api/skill-burgers", send("POST", { botId: h.bot, threadId: "t1" }));
  const name = saved.body.skill.name as string;
  level = "none";
  expect(await names(h.api)).toEqual([]);
  expect((await h.api(`/api/skill-burgers/${name}?botId=${h.bot}`)).status).toBe(404);
  expect((await h.api(`/api/skill-burgers/${name}`, send("PATCH", { botId: h.bot, everyChat: true }))).status).toBe(403);
  expect((await h.api(`/api/skill-burgers/${name}?botId=${h.bot}`, { method: "DELETE" })).status).toBe(403);
});

it("requires explicit consent before saving or sharing conversation-derived workflows on a team", async () => {
  const h = await serve({ requiresShareConsent: () => true, levelOf: () => "edit" });
  const body = { botId: h.bot, threadId: "t1" };
  expect((await h.api("/api/skill-burgers", send("POST", body))).status).toBe(403);
  const saved = await h.api("/api/skill-burgers", send("POST", { ...body, shareConsent: true }));
  expect(saved.status).toBe(201);
  const name = saved.body.skill.name as string;
  expect((await h.api(`/api/skill-burgers/${name}`, send("PATCH", { botId: h.bot, everyChat: true }))).status).toBe(403);
  expect((await h.api(`/api/skill-burgers/${name}`, send("PATCH", { botId: h.bot, everyChat: true, shareConsent: true }))).status).toBe(200);
});

it("does not let an admin move a shared workflow into a private bot they cannot edit", async () => {
  let level: "none" | "edit" = "edit";
  const h = await serve({ levelOf: () => level });
  const saved = await h.api("/api/skill-burgers", send("POST", { botId: h.bot, threadId: "t1" }));
  const name = saved.body.skill.name as string;
  expect((await h.api(`/api/skill-burgers/${name}`, send("PATCH", { botId: h.bot, everyChat: true }))).status).toBe(200);
  level = "none";
  expect((await h.api(`/api/skill-burgers/${name}`, send("PATCH", { everyChat: false }))).status).toBe(403);
});

it("does not reveal a private origin bot when a workflow is shared with a visible bot", async () => {
  let hidden = "";
  const h = await serve({ botIds: () => [hidden, "visible-bot"], levelOf: (auth, botId) => auth.scopes.includes("admin") ? "edit" : botId === hidden ? "none" : "view" });
  hidden = h.bot;
  const saved = await h.api("/api/skill-burgers", send("POST", { botId: h.bot, threadId: "t1" }));
  const name = saved.body.skill.name as string;
  expect((await h.api(`/api/skill-burgers/${name}`, send("PATCH", { botId: h.bot, everyChat: true }))).status).toBe(200);
  h.as(["client"]);
  const list = await h.api("/api/skill-burgers");
  expect(list.body.skills).toHaveLength(1);
  expect(list.body.skills[0]).not.toHaveProperty("botId");
});

it("does not expose a shared workflow to a member whose visible bot cannot use it", async () => {
  let assigned: string[] = [];
  const h = await serve({ levelOf: (auth) => auth.scopes.includes("admin") ? "edit" : "view", assignedSkills: () => assigned });
  const saved = await h.api("/api/skill-burgers", send("POST", { botId: h.bot, threadId: "t1" }));
  const name = saved.body.skill.name as string;
  expect((await h.api(`/api/skill-burgers/${name}`, send("PATCH", { everyChat: true, botId: h.bot }))).status).toBe(200);
  setLibrarySkillEveryBot(name, false, h.root);
  h.as(["client"]);
  expect(await names(h.api)).toEqual([]);
  expect((await h.api(`/api/skill-burgers/${name}`)).status).toBe(404);
  expect((await h.api(`/api/skill-burgers/${name}?runner=${h.bot}`)).status).toBe(404);
  assigned = [name];
  expect(await names(h.api)).toEqual([[name, true]]);
  expect((await h.api(`/api/skill-burgers/${name}`)).status).toBe(200);
  expect((await h.api(`/api/skill-burgers/${name}?runner=${h.bot}`)).status).toBe(200);
});

it("resolves workflow teammates in the requesting member's context", async () => {
  const messages = JSON.parse(readFileSync(new URL("../../shared/skill-burger/fixtures/qa-delegation-run.json", import.meta.url), "utf8")) as RunMessage[];
  const teammate = vi.fn((_auth: RequestAuth, name: string) => ({ name }));
  const { api, bot } = await serve({ levelOf: () => "edit", messages: () => messages, teammate }, ["client"]);
  const draft = await api("/api/skill-burger-draft", send("POST", { botId: bot, threadId: "t1" }));
  expect(draft.status).toBe(200);
  expect(teammate).toHaveBeenCalled();
  expect(teammate.mock.calls.every(([auth]) => auth.scopes.includes("client") && !auth.scopes.includes("admin"))).toBe(true);
});
