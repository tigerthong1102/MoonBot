import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { InstructionCaseResult, InstructionStudioView } from "../shared/instruction-studio.ts";

it("keeps the draft private until publication, compares one case on both instructions and restores the live version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-instruction-cases-"));
  const routes = join(dir, "answers.json");
  writeFileSync(routes, JSON.stringify({ "fixture-live-marker": "Previous answer", "fixture-draft-marker": "Kiểm tra MISA" }));
  const server = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_TEXT_DUMP: join(dir, "call.json"), FAKE_CLAUDE_VERSION: "2.1.321" });
  try {
    const api = async <T = any>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
      const response = await fetch(server.info.url + path, {
        method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(status);
      return result as T;
    };
    const { bot } = await api("/api/bots", "POST", { name: "Draft fixture" }, 201);
    const path = "/api/bots/" + bot.id;
    await api(path, "PATCH", { soul: "fixture-live-marker" });
    const studio = path + "/instruction-studio";
    const first = await api<InstructionStudioView>(studio);
    expect(first.draft).toMatchObject({ id: null, soul: "fixture-live-marker", cases: [] });
    const old = { revision: first.revision, id: null };
    const text = "fixture-draft-marker";
    const cases = [{ question: "Which app?", expected: "kiểm tra misa" }];
    const engines = await api("/api/instances");
    const alternative = engines.instances.find((item: { instanceId: string }) => item.instanceId === first.liveSelection.instanceId)
      .models.options.find((option: { id: string }) => option.id !== first.liveSelection.model).id;
    const selection = { instanceId: first.liveSelection.instanceId, model: alternative, effort: "high" };
    await api(studio + "/save", "POST", { ...old, soul: text, cases, selection: { ...selection, model: "fixture-missing-model" } }, 422);
    const draft = await api<InstructionStudioView>(studio + "/save", "POST", { ...old, soul: text, cases, selection });
    const pin = { revision: draft.revision, id: draft.draft.id };
    expect(draft.canTest).toBe(true);
    expect((await api(studio)).draft).toEqual(draft.draft);
    expect((await api(path + "/soul")).soul).toBe("fixture-live-marker");
    await api(studio + "/publish", "POST", old, 409);
    await api(studio + "/save", "POST", { ...pin, soul: "ế".repeat(9000), cases }, 400);
    const pair = async (scopes: string[]) => {
      const opened = await api("/api/auth/pairing", "POST", { label: "Studio test", scopes });
      const { token } = await api("/api/auth/pair", "POST", { code: opened.code });
      return { authorization: "Bearer " + token, "content-type": "application/json" };
    };
    const reader = await pair(["client"]);
    expect((await fetch(server.info.url + studio, { headers: reader })).status).toBe(403);
    const otherEditor = await pair(["admin", "client"]);
    const separate = await fetch(server.info.url + studio, { headers: otherEditor });
    expect(separate.status).toBe(200);
    expect(((await separate.json()) as InstructionStudioView).draft).toMatchObject({ id: null, soul: "fixture-live-marker", cases: [] });
    expect((await fetch(server.info.url + studio + "/publish", { method: "POST", headers: otherEditor, body: JSON.stringify(pin) })).status).toBe(409);
    const result = await api<InstructionCaseResult>(studio + "/test", "POST", { ...pin, index: 0 });
    expect(result).toEqual({ live: { answer: "Previous answer", pass: false }, draft: { answer: "Kiểm tra MISA", pass: true } });
    const argv = JSON.parse(readFileSync(join(dir, "call.json"), "utf8")).argv as string[];
    expect(argv[argv.indexOf("--model") + 1]).toBe(alternative);
    expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
    expect((await api(path + "/soul")).soul).toBe("fixture-live-marker");
    const published = await api<InstructionStudioView>(studio + "/publish", "POST", pin);
    expect(published.liveSoul).toBe(text);
    expect(published.liveSelection).toEqual(selection);
    expect(published.history[0]).toMatchObject({ model: first.liveSelection.model, canRestore: true });
    expect(published.draft.cases).toEqual(cases);
    const history = await api(path + "/history?full=1");
    const row = history.rows.find((entry: { via: string; field: string }) => entry.via === "draft" && entry.field === "soul");
    expect(row).toMatchObject({ field: "soul", before: "fixture-live-marker", after: text });
    const restored = await api<InstructionStudioView>(studio + "/restore", "POST", {
      revision: published.revision, id: published.draft.id, version: published.history[0]!.id,
    });
    expect(restored.liveSoul).toBe("fixture-live-marker");
    expect(restored.liveSelection).toEqual(first.liveSelection);
    expect(restored.history[0]).toMatchObject({ model: alternative, effort: "high", canRestore: true });
    await api(path, "PATCH", { title: "Edited elsewhere" });
    const changed = await api<InstructionStudioView>(studio);
    expect(changed.liveSoul).toBe("fixture-live-marker");
    expect(changed.revision).not.toBe(changed.draft.baseRevision);
    const newPin = { id: changed.draft.id, revision: changed.revision };
    await api(studio + "/publish", "POST", newPin, 409);
    const restarted = await api<InstructionStudioView>(studio + "/reset", "POST", newPin);
    expect(restarted.draft).toMatchObject({ soul: changed.liveSoul, baseRevision: changed.revision, cases });
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90_000);
