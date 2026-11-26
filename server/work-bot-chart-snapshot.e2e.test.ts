import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { DataCard, DataPage, DataSheet } from "../shared/data-surface.ts";
import type { BotRecord, Message } from "./store.ts";

it("keeps the original counts when a worker reruns a chart copied from the main chat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-chart-handoff-fixture-"));
  const routes = join(dir, "topics.json");
  const work = "Monitor weekly synthetic warehouse counts";
  writeFileSync(routes, JSON.stringify({ [work]: JSON.stringify({ name: "Warehouse counts", icon: "box" }) }));
  const owner = randomBytes(32).toString("base64url");
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, OMB_TEST_DESKTOP_OWNER_TOKEN: owner, FAKE_CLAUDE_TEXT_ROUTES: routes });
    const base = fixture.info.url;
    async function api<T>(path: string, body?: unknown): Promise<T> {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: { origin: base, "x-openmausbot-desktop-owner": owner, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result as T;
    }
    const bots = async () => (await api<{ bots: BotRecord[] }>("/api/bots?messages=0")).bots;
    const messages = async (thread: string) => (await api<{ messages: Message[] }>(`/api/threads/${thread}/messages`)).messages;
    const marks = async (bot: string, cardId: string) => (await api<DataPage>(`/api/bots/${bot}/data/page`, {
      cardId, offset: 0, limit: 10, sort: { column: "x", direction: "asc" },
    })).rows;
    const sheet = async (id: string) => (await api<{ sheet: DataSheet }>(`/api/bots/${id}/data`)).sheet;
    const main = (await bots()).find(bot => bot.defaultBot)!;
    const { card: source } = await api<{ card: DataCard }>(`/api/bots/${main.id}/data/run`, {
      sql: "SELECT * FROM (VALUES ('East'), ('East'), ('East'), ('West'), ('West')) AS warehouses(x)",
      title: "Warehouse counts", chart: { type: "bar", x: "x", agg: "count" },
    });
    const expected = [["East", "3"], ["West", "2"]];
    expect(await marks(main.id, source.id)).toEqual(expected);
    await api(`/api/bots/${main.id}/messages`, { threadId: main.threadId, text: work, sendId: randomUUID(), dataContext: { cardId: source.id } });
    const offerId = async () => (await messages(main.threadId)).find(row => row.card?.teamSetupRequest?.workBotOffer)?.card?.requestId;
    await expect.poll(offerId, { timeout: 20000 }).toBeTruthy();
    const requestId = await offerId();
    const handoff = await api<{ result: { bots: Array<{ id: string }> } }>(`/api/threads/${main.threadId}/respond`, { requestId, behavior: "allow" });
    const worker = (await bots()).find(bot => bot.id === handoff.result.bots[0]!.id)!;
    const cardId = (await messages(worker.threadId)).find(row => row.role === "user" && row.text === work)!.dataContext!.cardId;
    const snapshot = (await sheet(worker.id)).cards.find(card => card.id === cardId)!;
    expect(snapshot).toMatchObject({ kind: "chart", vegaLite: source.vegaLite, reduction: source.reduction });
    expect(await marks(worker.id, cardId)).toEqual(expected);
    await api(`/api/bots/${worker.id}/data/run`, { cardId, sql: snapshot.sql });
    expect(await marks(worker.id, cardId)).toEqual(expected);
    expect((await sheet(main.id)).cards.find(card => card.id === source.id)).toEqual(source);
    expect(await marks(main.id, source.id)).toEqual(expected);
  } finally {
    await fixture?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
