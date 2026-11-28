import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("sends only the current message to the selected isolated HTTP provider, once per job", async () => {
  const calls: string[] = [];
  let delay = false,
    acknowledge!: () => void,
    finish!: () => void;
  const started = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const provider = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") return res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString(),
      parsed = JSON.parse(raw);
    expect(parsed).toBeDefined();
    if (raw.includes("CURRENT_QUESTION")) {
      calls.push(raw);
      if (delay) {
        acknowledge();
        await pending;
      }
    }
    res.end(
      JSON.stringify({
        id: "fixture",
        model: "fixture-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              ...(raw.includes("REASONING_ONLY")
                ? { content: "", reasoning_content: "Private analysis must stay private." }
                : { content: "General fixture answer." }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw Error("Expected fixture port");
  const origin = `http://127.0.0.1:${address.port}`,
    token = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer(
    { OMB_TEST_DESKTOP_OWNER_TOKEN: token, OMB_DEV_TRUST_LOCAL_BROWSER: "0", OMB_AI_TWIN: "1" },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    origin,
  );
  const path = "/inbox-generated";
  const call = (suffix: string, body?: object, method = body ? "POST" : "GET", extra: Record<string, string> = {}) =>
    fetch(fixture.info.url + "/api/ai-twin" + suffix, {
      method,
      headers: { "x-openmausbot-desktop-owner": token, "content-type": "application/json", ...extra },
      ...(body && { body: JSON.stringify(body) }),
    });
  try {
    const profile = (await (await call("")).json()) as { creationEpoch: string };
    const create = (await (
      await call("", {
        name: "Private fixture name",
        createConsent: true,
        creationId: randomUUID(),
        creationEpoch: profile.creationEpoch,
      })
    ).json()) as { twin: { id: string; revision: number } };
    const styled = await call(
      "",
      {
        id: create.twin.id,
        revision: create.twin.revision,
        name: "Secret fixture identity",
        style: "PRIVATE_STYLE_SECRET",
        paused: false,
      },
      "PATCH",
    );
    expect(styled.status).toBe(200);
    const latest = (await styled.json()) as { twin: { id: string; revision: number } };
    const saved = await call("/lessons", {
      id: latest.twin.id,
      revision: latest.twin.revision,
      question: "CURRENT_QUESTION",
      answer: "PRIVATE_LESSON_SECRET",
      allowProvider: true,
      saveAsLesson: true,
    });
    expect(saved.status).toBe(200);
    let current!: {
      provider: { key: string; destination: string; model: string } | null;
      twin: { id: string; revision: number };
    };
    await expect
      .poll(
        async () => {
          current = (await (await call(path)).json()) as typeof current;
          return current.provider?.destination;
        },
        { timeout: 15000 },
      )
      .toBe(origin);
    const fields = {
      id: current.twin.id,
      revision: current.twin.revision,
      key: current.provider!.key,
      job: randomUUID(),
      question: "CURRENT_QUESTION",
      useProvider: true,
    };
    expect((await call(path, fields, "POST", { origin: "https://unrelated.example" })).status).toBe(403);
    expect((await call(path, { ...fields, key: randomUUID() })).status).toBe(409);
    expect((await call(path, { ...fields, useMemory: true })).status).toBe(400);
    const result = await call(path, fields);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ answer: "General fixture answer." });
    expect((await call(path, fields)).status).toBe(409);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatch(/PRIVATE_STYLE_SECRET|PRIVATE_LESSON_SECRET|Secret fixture identity|"tools"/);
    const reasoning = await call(path, { ...fields, job: randomUUID(), question: "REASONING_ONLY" });
    expect(reasoning.status).toBe(409);
    expect(await reasoning.text()).not.toContain("Private analysis");
    delay = true;
    const inflight = call(path, { ...fields, job: randomUUID() });
    await started;
    expect((await call(path, { ...fields, job: randomUUID() })).status).toBe(409);
    expect(
      (await call("", { id: fields.id, revision: fields.revision, name: "Fixture", style: "", paused: true }, "PATCH"))
        .status,
    ).toBe(200);
    finish();
    expect((await inflight).status).toBe(409);
    expect(calls).toHaveLength(2);
  } finally {
    finish();
    await fixture.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
}, 60000);
