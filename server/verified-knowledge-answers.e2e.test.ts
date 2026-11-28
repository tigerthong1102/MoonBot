import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("uses the authenticated desktop's actual conversation as the only model evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verified-knowledge-"));
  const routes = join(dir, "routes.json"), log = join(dir, "calls.jsonl");
  const owner = randomBytes(32).toString("base64url");
  writeFileSync(routes, JSON.stringify({ "Answer only from the selected conversation messages": JSON.stringify({ paragraphs: [{ text: "Fixture answer.", sources: [1] }] }) }));
  const fixture = await launchVerificationServer({ OMB_TEST_DESKTOP_OWNER_TOKEN: owner, FAKE_CLAUDE_VERSION: "2.1.321", FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_TEXT_LOG: log });
  try {
    const base = fixture.info.url, headers = { "x-openmausbot-desktop-owner": owner, "content-type": "application/json" };
    const doctor = await runControlOmb(["doctor", "--url", base]) as { ok: boolean };
    expect(doctor.ok).toBe(true);
    const bots = await fetch(`${base}/api/bots?messages=0`, { headers }).then(r => r.json()) as { bots: Array<{ id: string; threadId: string; modelSelection: { instanceId: string; model: string } }> };
    const bot = bots.bots[0]!, text = "Fixture source: refund window is thirty days.";
    const send = await fetch(`${base}/api/bots/${bot.id}/messages`, { method: "POST", headers, body: JSON.stringify({ text }) });
    expect(send.status).toBe(202);
    let messages: Array<{ id: string; role: string; text?: string }> = [];
    await expect.poll(async () => {
      const state = await fetch(`${base}/api/bots`, { headers }).then(r => r.json()) as {
        bots: Array<{ id: string; busy: boolean; messages: typeof messages }>;
      };
      const current = state.bots.find(candidate => candidate.id === bot.id)!;
      messages = current.messages;
      return current.busy === false && messages.some(m => m.role === "user" && m.text === text)
        && messages.some(m => m.role === "bot" && m.text);
    }, { timeout: 30_000, interval: 100 }).toBe(true);
    const source = messages.find(m => m.role === "user" && m.text === text)!;
    const path = `${base}/api/bots/${bot.id}/knowledge-answers/verified`;
    const body = { threadId: bot.threadId, question: "What is the refund window?", allowProvider: true,
      provider: { instanceId: bot.modelSelection.instanceId, model: bot.modelSelection.model }, messages: [{ id: source.id, expectedSha256: createHash("sha256").update(text).digest("hex") }] };
    const denied = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    const forged = await fetch(path, { method: "POST", headers, body: JSON.stringify({ ...body, evidence: [{ text: "Forged source" }] }) });
    expect(forged.status).toBe(400);
    const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ paragraphs: [{ text: "Fixture answer.", sources: [1] }], sources: [{ messageId: source.id }] });
    const prompts = readFileSync(log, "utf8");
    expect(prompts).toContain(text);
    expect(prompts).not.toContain("Forged source");
  } finally { await fixture.close(); rmSync(dir, { recursive: true, force: true }); }
}, 90_000);
