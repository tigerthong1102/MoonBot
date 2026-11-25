import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { AI_TWIN_PATH, AI_TWIN_PREVIEW_PATH, type AiTwinView } from "../shared/ai-twin.ts";
import { AI_TWIN_PRIVATE_DIR, createAiTwinStore } from "./ai-twin.ts";
import { createWorkspaceBackupSnapshot, stagedWorkspaceData, stageWorkspaceBackup } from "./workspace-backup.ts";

async function launchTwin(enabled: boolean, provider: NodeJS.ProcessEnv = {}) {
  const token = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({
    ...provider,
    OMB_TEST_DESKTOP_OWNER_TOKEN: token,
    OMB_DEV_TRUST_LOCAL_BROWSER: "0",
    OMB_AI_TWIN: enabled ? "1" : "0",
  });
  const url = fixture.info.url;
  const owner = { "x-openmausbot-desktop-owner": token };
  const call = (method = "GET", data?: unknown, headers: Record<string, string> = owner) =>
    fetch(url + AI_TWIN_PATH, {
      method, headers: { "content-type": "application/json", ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  return { fixture, url, owner, call };
}

it("leaves the profile absent when the feature is disabled, even on an authenticated desktop", async () => {
  const { fixture, call } = await launchTwin(false);
  try {
    expect((await call()).status).toBe(404);
    expect(existsSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR))).toBe(false);
  } finally {
    await fixture.close();
  }
}, 60_000);

it("binds the Twin to the desktop owner and workspace, persists edits, excludes it from export and fences stale requests", async () => {
  const { fixture, url, owner, call } = await launchTwin(true);
  try {
    const start = await call();
    expect(start.status).toBe(200);
    expect(start.headers.get("cache-control")).toBe("private, no-store");
    const { creationEpoch } = await start.json() as AiTwinView;
    const create = { name: "Thông AI", creationId: randomUUID(), creationEpoch, createConsent: true };
    expect((await call("POST", { ...create, createConsent: false })).status).toBe(400);
    expect((await call("POST", { ...create, owner: "forged" })).status).toBe(400);
    expect(existsSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR))).toBe(false);

    const made = await call("POST", create);
    expect(made.status).toBe(201);
    const twin = (await made.json() as AiTwinView).twin!;
    expect(twin).toEqual({
      id: expect.any(String), name: "Thông AI", style: "", paused: false, revision: 1, createdAt: expect.any(Number), updatedAt: expect.any(Number),
    });
    const replay = await call("POST", create);
    expect(replay.status).toBe(200);
    expect((await replay.json() as AiTwinView).twin?.id).toBe(twin.id);
    expect((await call("POST", { ...create, creationId: randomUUID() })).status).toBe(409);

    const untrusted: Record<string, string>[] = [{}, { "x-openmausbot-desktop-owner": "incorrect" }, { ...owner, "x-forwarded-for": "203.0.113.5" }];
    for (const headers of untrusted) {
      expect((await call("GET", undefined, headers)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await call("GET", undefined, { ...owner, origin: "http://127.0.0.1:1", "sec-fetch-site": "same-site" })).status).toBeGreaterThanOrEqual(400);
    const paired = await fetch(url + "/api/auth/pairing", { method: "POST", headers: { ...owner, "content-type": "application/json" }, body: "{}" });
    expect(paired.status).toBe(200);
    const { code } = await paired.json() as { code: string };
    const exchange = await fetch(url + "/api/auth/pair", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, label: "Fixture device" }),
    });
    const { token } = await exchange.json() as { token: string };
    expect(token).toEqual(expect.any(String));
    expect((await call("GET", undefined, { authorization: `Bearer ${token}` })).status).toBeGreaterThanOrEqual(400);
    expect((await call("PATCH", { id: twin.id, revision: twin.revision }, { authorization: `Bearer ${token}` })).status).toBeGreaterThanOrEqual(400);

    const patch = { id: twin.id, revision: twin.revision, name: twin.name, style: "Viết ngắn gọn và dẫn nguồn.", paused: true };
    const [first, second] = await Promise.all([call("PATCH", patch), call("PATCH", patch)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const current = (await (await call()).json() as AiTwinView).twin!;
    expect(current).toMatchObject({ style: patch.style, paused: true, revision: 2 });

    const dataDir = fixture.info.dataDir;
    const workspace = readFileSync(join(dataDir, "environment-id"), "utf8").trim();
    expect(createAiTwinStore(dataDir, workspace).get().twin).toEqual(current);
    expect(() => createAiTwinStore(dataDir, "other-workspace").get()).toThrow(/another workspace/);
    const botsBefore = await fetch(url + "/api/bots", { headers: owner }).then((res) => res.text());
    expect(botsBefore).not.toContain(twin.id);
    const password = "fixture backup password";
    const madeBackup = await createWorkspaceBackupSnapshot(dataDir, { password, appVersion: "test" });
    const staged = await stageWorkspaceBackup(dataDir, madeBackup.path, { password, currentAppVersion: "test" });
    expect(existsSync(join(stagedWorkspaceData(dataDir, staged.id).data, AI_TWIN_PRIVATE_DIR))).toBe(false);

    expect((await call("DELETE", { id: twin.id, revision: twin.revision })).status).toBe(409);
    expect((await call("DELETE", { id: twin.id, revision: current.revision })).status).toBe(200);
    expect((await call("POST", create)).status).toBe(409);
    const deleted = await (await call()).json() as AiTwinView;
    expect(deleted.twin).toBeNull();
    expect(deleted.creationEpoch).not.toBe(creationEpoch);
    const persisted = readFileSync(join(dataDir, AI_TWIN_PRIVATE_DIR, "profile.json"), "utf8");
    expect(persisted).not.toContain(twin.id);
    expect(persisted).not.toContain(current.style);
  } finally {
    await fixture.close();
  }
}, 90_000);

it("only makes a consented, tool-free text preview through the selected provider and keeps it out of the chat", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-twin-preview-"));
  const routes = join(scratch, "routes.json");
  const promptLog = join(scratch, "prompts.jsonl");
  const question = "PROBE_TWIN: Mời khách đặt lịch trao đổi thế nào?";
  const sample = "Mời bạn gửi hai khung giờ thuận tiện để trao đổi.";
  writeFileSync(routes, JSON.stringify({ PROBE_TWIN: sample }));

  try {
    const { fixture, url, owner, call } = await launchTwin(true, {
      FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_TEXT_LOG: promptLog,
    });
    try {
      const { creationEpoch } = (await (await call()).json()) as AiTwinView;
      const made = await call("POST", { name: "Thông AI", creationId: randomUUID(), creationEpoch, createConsent: true });
      const twin = ((await made.json()) as AiTwinView).twin!;
      const styled = await call("PATCH", { id: twin.id, revision: twin.revision, paused: false, name: twin.name, style: "Viết lịch sự, ngắn gọn." });
      expect(styled.status).toBe(200);
      const current = (await styled.json()) as AiTwinView;
      expect(current.preview).toMatchObject({ key: expect.any(String), model: expect.any(String) });
      const version = { id: twin.id, revision: current.twin!.revision };
      const input = { ...version, key: current.preview!.key, question, useProvider: true };
      const preview = (data: unknown, headers = owner) => fetch(url + AI_TWIN_PREVIEW_PATH, {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data),
      });
      const recorded = () => existsSync(promptLog) ? readFileSync(promptLog, "utf8") : "";
      expect((await preview({ ...input, useProvider: false })).status).toBe(400);
      expect((await preview({ ...input, key: randomUUID() })).status).toBe(409);
      expect((await preview(input, { "x-openmausbot-desktop-owner": "wrong" })).status).toBeGreaterThanOrEqual(400);
      expect(recorded()).not.toContain("PROBE_TWIN");

      const response = await preview(input);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ draft: sample });
      expect(recorded()).toContain("Viết lịch sự, ngắn gọn.");
      expect(recorded().match(/PROBE_TWIN/g)).toHaveLength(1);
      const archived = readFileSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR, "profile.json"), "utf8");
      expect(archived).not.toContain("PROBE_TWIN");
      expect(archived).not.toContain(sample);

      expect((await call("PATCH", { ...version, paused: true, name: twin.name, style: current.twin!.style })).status).toBe(200);
      expect((await preview(input)).status).toBe(409);
      expect(recorded().match(/PROBE_TWIN/g)).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 90_000);
