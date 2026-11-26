import { createServer } from "node:http";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { fixtureApi } from "../scripts/testing/preview-fixture.ts";

it("runs independent ballots, the optional critique and the chair from a real room send", async () => {
  const models = ["gpt-council", "claude-council", "grok-council"];
  const calls: Array<{ model: string; prompt: string }> = [];
  const provider = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: models.map(id => ({ id })) }));
    if (req.url !== "/v1/chat/completions") return res.writeHead(404).end();
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const prompt = body.messages[0].content;
    const stage = prompt.includes("Chair this council") ? "final" : prompt.includes("Critique the arguments") ? "critique" : "ballot";
    calls.push({ model: body.model, prompt });
    res.end(JSON.stringify({ model: body.model, usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ message: { content: `${stage} from ${body.model}` }, finish_reason: "stop" }] }));
  });
  await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("missing fixture port");
  const host = await launchVerificationServer();
  const api = fixtureApi(host.info.url, { headers: { origin: host.info.url } });
  try {
    await api("PUT", "/api/config", { openaiCompat: { url: `http://127.0.0.1:${address.port}/v1`, key: "fixture", model: models[0] }, instances: { openaiCompat: { driver: "openai-compat" } } });
    const ids: string[] = [];
    for (const model of models) {
      const { bot } = await api("POST", "/api/bots", { name: model, modelSelection: { instanceId: "openaiCompat", model } });
      ids.push(bot.id);
    }
    const { group } = await api("POST", "/api/groups", { name: "Council fixture", memberIds: ids, defaultResponder: { kind: "member", botId: ids[0] } });
    await api("PATCH", `/api/groups/${group.id}/setup`, { action: "complete", cwd: null, bulletin: "", defaultResponder: { kind: "member", botId: ids[0] } });
    expect(group.councilAvailable).toBe(true);
    const { code } = await api("POST", "/api/auth/pairing", { scopes: ["client"] });
    const { token } = await api("POST", "/api/auth/pair", { code, label: "Council phone fixture" });
    expect(token).toContain("omb_");
    const phone = fixtureApi(host.info.url, { headers: { origin: host.info.url, authorization: `Bearer ${token}` } });
    let sequence = 0;
    const send = (text: string) => phone("POST", `/api/groups/${group.id}/messages`, {
      text, threadId: group.threadId, sendId: `native_council_fixture_${++sequence}`,
    });
    await send("/council --critique Should we launch?");
    const transcript = async () => (await api("GET", `/api/threads/${group.threadId}/messages`)).messages as Array<{ tool?: { name?: string }; text?: string }>;
    await expect.poll(async () => {
      const reply = (await transcript()).find(m => m.tool?.name?.includes("did not finish") || m.tool?.name?.includes("Add active room bots") || m.text?.includes("Chair’s synthesis"));
      return reply?.tool?.name ?? (reply ? "synthesized" : "pending");
    }, { timeout: 10000 }).toBe("synthesized");
    const ballots = calls.filter(c => c.prompt.includes("Give your independent answer"));
    expect(ballots.map(c => c.model).sort()).toEqual([...models].sort());
    expect(ballots.every(c => !c.prompt.includes("ballot from"))).toBe(true);
    const critiques = calls.filter(c => c.prompt.includes("Critique the arguments"));
    expect(critiques).toHaveLength(3);
    expect(critiques.every(c => models.every(m => c.prompt.includes("ballot from " + m)))).toBe(true);
    const chair = calls.find(c => c.prompt.includes("Chair this council"))!;
    expect(chair.model).toBe(models[0]);
    expect(models.every(m => chair.prompt.includes("critique from " + m))).toBe(true);
    await send("/council Another question");
    await expect.poll(() => calls.filter(c => c.prompt.includes("Chair this council")).length, { timeout: 15000 }).toBe(2);
    expect(calls.filter(c => c.prompt.includes("Critique the arguments"))).toHaveLength(3);
    const messages = async (): Promise<Array<{ text?: string; tool?: { name?: string } }>> =>
      (await api("GET", `/api/threads/${group.threadId}/messages`)).messages;
    await expect.poll(async () => (await messages()).filter(m => m.text?.includes("Chair’s synthesis")).length).toBe(2);
    // Three concurrent requests may already be in flight. Their usage must stop the next round.
    await api("PUT", "/api/usage/caps", { run: { tokens: 40 } });
    await send("/council --critique Budget fixture");
    await expect.poll(async () => (await messages()).filter(m => m.tool?.name?.includes("did not finish")).length, { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    expect(calls.filter(c => c.prompt.includes("Budget fixture"))).toHaveLength(3);
  } finally { await host.close(); provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r())); }
}, 90000);
