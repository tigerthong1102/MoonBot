import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { BotRecord, Message } from "./store.ts";

it.each(["before", "after", "target-first"])("avoids a duplicate when the first schedule appears %s", async timing => {
  const dir = mkdtempSync(join(tmpdir(), "work-bot-existing-schedule-"));
  const routes = join(dir, "routes.json"), text = "Track the synthetic AI news daily";
  const sourceRetry = "Create the synthetic news schedule on the original bot";
  writeFileSync(routes, JSON.stringify({ [text]: JSON.stringify({ name: "Synthetic news", icon: "calendar" }), [sourceRetry]: "null" }));
  const token = randomBytes(32).toString("base64url"), previousFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => previousFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": token } });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, OMB_TEST_DESKTOP_OWNER_TOKEN: token }, undefined, undefined, undefined, undefined, { scripted: true });
    const base = fixture.info.url;
    const api = async <T>(path: string, body?: unknown, method = body ? "POST" : "GET") => {
      const response = await fetch(base + path, { method, headers: { origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value as T;
    };
    const bots = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const main = (await bots()).find(bot => bot.defaultBot)!;
    await api(`/api/bots/${main.id}`, { approvalMode: "full" }, "PATCH");
    const createOld = async () => (await api<{ routine: { id: string } }>("/api/routines", { name: "Existing synthetic schedule", prompt: "Check synthetic AI news", botId: main.id, enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86400000 } })).routine;
    let old = timing === "before" ? await createOld() : undefined;
    const rows = async (threadId: string) => (await api<{ messages: Message[] }>(`/api/threads/${threadId}/messages`)).messages;
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() });
    await expect.poll(async () => (await rows(main.threadId)).some(row => row.card?.teamSetupRequest?.workBotOffer), { timeout: 20000 }).toBe(true);
    const card = (await rows(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)!.card!;
    const targetId = card.teamSetupRequest!.operations.find(operation => operation.action === "create")!.botId;
    const create = { tool: "create_trigger", ...(timing !== "target-first" ? { expectError: true } : {}), ...(timing === "after" ? { delayMs: 5000 } : {}), arguments: { when: "schedule", name: "Synthetic news schedule", instructions: "Check synthetic AI news", schedule: { type: "weekly", time: "03:01", weekdays: ["monday"] } } };
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [targetId]: { script: [{ key: "schedule", match: [text], steps: [create], reply: "Please review the existing schedule." }, { key: "retry", match: ["Please retry the schedule"], steps: [create], reply: "The existing schedule still needs review." }] }, [main.id]: { script: [{ key: "source-retry", match: [sourceRetry], steps: [{ ...create, expectError: true }], reply: "The linked schedule needs review." }] } }));
    await api(`/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    const target = (await bots()).find(bot => bot.id === targetId)!;
    if (!old && timing === "after") old = await createOld();
    if (timing === "target-first") {
      await expect.poll(async () => (await api<{ routines: Array<{ botId: string }> }>("/api/routines")).routines.filter(routine => routine.botId === targetId).length, { timeout: 30000 }).toBe(1);
      await expect.poll(async () => !(await bots()).find(bot => bot.id === targetId)?.busy, { timeout: 30000 }).toBe(true);
      await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: sourceRetry, sendId: randomUUID() });
      await expect.poll(async () => (await rows(main.threadId)).some(row => JSON.stringify(row).includes("may overlap")), { timeout: 30000 }).toBe(true);
      expect((await api<{ routines: unknown[] }>("/api/routines")).routines).toHaveLength(1);
      return;
    }
    try { await expect.poll(async () => (await rows(target.threadId)).some(row => JSON.stringify(row).includes("may overlap")), { timeout: 30000 }).toBe(true); }
    catch (error) { throw new Error(`Synthetic target rows: ${JSON.stringify(await rows(target.threadId))}`, { cause: error }); }
    const routines = (await api<{ routines: Array<{ id: string; enabled: boolean }> }>("/api/routines")).routines;
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({ id: old!.id, enabled: true });
    expect(JSON.stringify(await rows(target.threadId))).toContain("may overlap");
    await expect.poll(async () => !(await bots()).find(bot => bot.id === targetId)?.busy, { timeout: 30000 }).toBe(true);
    await api(`/api/bots/${targetId}/messages`, { threadId: target.threadId, text: "Please retry the schedule", sendId: randomUUID() });
    try { await expect.poll(async () => (await rows(target.threadId)).filter(row => JSON.stringify(row).includes("may overlap")).length, { timeout: 30000 }).toBeGreaterThanOrEqual(2); }
    catch (error) { throw new Error(`Synthetic retry rows: ${JSON.stringify(await rows(target.threadId))}`, { cause: error }); }
    expect((await api<{ routines: unknown[] }>("/api/routines")).routines).toHaveLength(1);
  } finally {
    await fixture?.close();
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
