import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { AI_TWIN_DELEGATION_PATH, AI_TWIN_LEARNING_PATH, AI_TWIN_PHONE_PATH, AI_TWIN_LESSONS_PATH, AI_TWIN_LOOKUP_PATH, AI_TWIN_PATH, AI_TWIN_PREVIEW_PATH, type AiTwinView, type AiTwinLearningView } from "../shared/ai-twin.ts";
import { AI_TWIN_PRIVATE_DIR, createAiTwinStore } from "./ai-twin.ts";
import { createWorkspaceBackupSnapshot, stagedWorkspaceData, stageWorkspaceBackup } from "./workspace-backup.ts";

async function launchTwin(provider: NodeJS.ProcessEnv = {}) {
  const token = randomBytes(32).toString("base64url");
  const companionToken = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({
    ...provider,
    OMB_TEST_COMPANION_OWNER_TOKEN: companionToken,
    OMB_TEST_DESKTOP_OWNER_TOKEN: token,
    OMB_DEV_TRUST_LOCAL_BROWSER: "0",
  });
  const url = fixture.info.url;
  const owner = { "x-openmausbot-desktop-owner": token };
  const call = (method = "GET", data?: unknown, headers: Record<string, string> = owner) =>
    fetch(url + AI_TWIN_PATH, {
      method, headers: { "content-type": "application/json", ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const phone = { "x-openmausbot-companion": "1", "x-openmausbot-companion-auth": companionToken, "x-openmausbot-companion-device": "test-phone" };
  return { fixture, url, owner, phone, call };
}

it("leaves the profile absent when the feature is disabled, even on an authenticated desktop", async () => {
  const { fixture, url, owner, call } = await launchTwin({ OMB_AI_TWIN: "0" });
  try {
    expect((await call()).status).toBe(404);
    const config = await fetch(url + "/api/config", { headers: owner }).then((res) => res.json());
    expect(config).not.toHaveProperty("features.aiTwin");
    expect(existsSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR))).toBe(false);
  } finally {
    await fixture.close();
  }
}, 60_000);

it("does not offer AI Twin on a standalone server", async () => {
  const fixture = await launchVerificationServer({});
  try {
    const config = await fetch(fixture.info.url + "/api/config").then((res) => res.json());
    expect(config).not.toHaveProperty("features.aiTwin");
    expect((await fetch(fixture.info.url + AI_TWIN_PATH)).status).toBe(404);
    expect(existsSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR))).toBe(false);
  } finally {
    await fixture.close();
  }
}, 60_000);

it("offers Twin setup by default only to the desktop owner and keeps the profile absent until creation", async () => {
  const { fixture, url, owner, call } = await launchTwin();
  try {
    const config = await fetch(url + "/api/config", { headers: owner }).then((res) => res.json());
    expect(config).toMatchObject({ features: { aiTwin: true } });
    const start = await call();
    expect(start.status).toBe(200);
    expect(start.headers.get("cache-control")).toBe("private, no-store");
    const { creationEpoch, twin: beforeCreation } = await start.json() as AiTwinView;
    expect(beforeCreation).toBeNull();
    expect(existsSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR))).toBe(false);
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
  writeFileSync(routes, JSON.stringify({ PROBE_TWIN: sample, PROBE_ZALO: "Cần đối chiếu công nợ." }));

  try {
    const { fixture, url, owner, call } = await launchTwin({
      FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_TEXT_LOG: promptLog, FAKE_CLAUDE_VERSION: "2.1.321",
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

      expect((await preview({ ...input, zaloRecipe: "arbitrary-tool" })).status).toBe(400);
      expect((await preview({ ...input, zaloRecipe: "zalo-ke-toan" })).status).toBe(400);
      const industry = await preview({ ...input, question: "PROBE_ZALO: Xin đối chiếu công nợ", zaloRecipe: "zalo-ke-toan", zaloSource: { source: "Nhóm mẫu", line: 42 } });
      expect(industry.status).toBe(200);
      expect(recorded()).toContain("Rà soát yêu cầu kế toán");
      expect(recorded()).toContain("Nhóm mẫu");
      expect(recorded()).toContain("42");
      expect(recorded().match(/PROBE_ZALO/g)).toHaveLength(1);

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

it("stores only explicitly approved owner lessons and looks them up offline with source metadata", async () => {
  const { fixture, url, owner, call } = await launchTwin();
  try {
    const { creationEpoch } = (await (await call()).json()) as AiTwinView;
    const made = await call("POST", { name: "Thông AI", creationId: randomUUID(), creationEpoch, createConsent: true });
    const twin = ((await made.json()) as AiTwinView).twin!;
    const withVersion = { id: twin.id, revision: twin.revision };
    const question = "Số dư -10 nghĩa là gì?";
    const answer = "Hồ sơ giả lập đang thiếu 10.";
    const request = (path: string, method: string, data: object, headers: Record<string, string> = owner) =>
      fetch(url + path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
    const teach = { ...withVersion, question, answer, saveAsLesson: true };
    expect((await request(AI_TWIN_LESSONS_PATH, "POST", { ...teach, saveAsLesson: false })).status).toBe(400);
    expect((await request(AI_TWIN_LESSONS_PATH, "POST", { ...teach, source: "model" })).status).toBe(400);
    expect((await request(AI_TWIN_LESSONS_PATH, "POST", teach, {})).status).toBeGreaterThanOrEqual(400);

    const saved = await request(AI_TWIN_LESSONS_PATH, "POST", teach);
    expect(saved.status).toBe(200);
    const next = await saved.json() as AiTwinView;
    const learned = next.lessons![0]!;
    const version = { id: twin.id, revision: next.twin!.revision };
    expect(learned).toMatchObject({ question, answer, source: "owner", id: expect.any(String) });
    expect((await request(AI_TWIN_LESSONS_PATH, "POST", { ...teach, ...version, question: "SỐ DƯ -10 NGHĨA LÀ GÌ" })).status).toBe(409);
    const lookup = { ...version, question: question.toUpperCase() };
    const recalled = await request(AI_TWIN_LOOKUP_PATH, "POST", lookup);
    expect(recalled.headers.get("cache-control")).toBe("private, no-store");
    expect(await recalled.json()).toEqual({ lesson: learned });
    expect(await (await request(AI_TWIN_LOOKUP_PATH, "POST", { ...lookup, question: "Số dư 10 nghĩa là gì?" })).json()).toEqual({ lesson: null });
    expect((await request(AI_TWIN_LOOKUP_PATH, "POST", lookup, {})).status).toBeGreaterThanOrEqual(400);

    const removed = await request(AI_TWIN_LESSONS_PATH, "DELETE", { ...version, lessonId: learned.id });
    expect(removed.status).toBe(200);
    const replaced = (await removed.json()) as AiTwinView;
    expect(replaced.lessons).toEqual([]);
    expect((await request(AI_TWIN_LOOKUP_PATH, "POST", lookup)).status).toBe(409);
    expect(await (await request(AI_TWIN_LOOKUP_PATH, "POST", { ...lookup, revision: replaced.twin!.revision })).json()).toEqual({ lesson: null });
    expect(readFileSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR, "profile.json"), "utf8")).not.toContain(answer);
  } finally {
    await fixture.close();
  }
}, 90_000);

it("recalls a Vietnamese paraphrase on request, abstains on different amounts, and sends answers only to a grounded draft", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-twin-recall-"));
  const routes = join(scratch, "routes.json");
  const log = join(scratch, "prompts.jsonl");
  const canonical = "Bên mình hoàn tiền trong bao lâu?";
  const answer = "Mốc hoàn tiền nội bộ là hai ngày.";
  const question = "Sau mấy ngày tôi nhận lại tiền?";
  writeFileSync(routes, JSON.stringify({ "approvedLesson": "Chúng tôi hoàn tiền trong hai ngày.", "Verify this possible FAQ match": "SAME", [question]: "0", "Khi nào chốt lịch họp": "NONE" }));
  const { fixture, url, owner, call } = await launchTwin({
    FAKE_CLAUDE_TEXT_ROUTES: routes, FAKE_CLAUDE_TEXT_LOG: log, FAKE_CLAUDE_VERSION: "2.1.321",
  });
  try {
    const initial = await (await call()).json() as AiTwinView;
    const view = await (await call("POST", {
      name: "Twin kiểm thử", creationId: randomUUID(), creationEpoch: initial.creationEpoch, createConsent: true,
    })).json() as AiTwinView;
    const post = (path: string, input: object) => fetch(url + path, {
      method: "POST", headers: { ...owner, "content-type": "application/json" }, body: JSON.stringify(input),
    });
    const teach = async (current: AiTwinView, question: string, answer: string, allowProvider = true) => {
      const response = await post(AI_TWIN_LESSONS_PATH, { id: current.twin!.id, revision: current.twin!.revision, question, answer, saveAsLesson: true, allowProvider });
      expect(response.status).toBe(200);
      return await response.json() as AiTwinView;
    };
    const one = await teach(view, canonical, answer);
    const amount = await teach(one, "Phí hủy là -10 đúng không?", "Giá trị âm trong hồ sơ giả lập.");
    const two = await teach(amount, "Câu hỏi riêng chỉ được tra nội bộ", "Đáp án vẫn giữ riêng tư", false);
    const provider = two.preview!;
    const version = { id: two.twin!.id, revision: two.twin!.revision };
    const choice = { ...version, question, useProvider: true, key: provider.key };
    const read = () => existsSync(log) ? readFileSync(log, "utf8") : "";
    expect(await (await post(AI_TWIN_LOOKUP_PATH, { ...version, question })).json()).toEqual({ lesson: null });
    expect(read()).not.toContain(question);
    expect(await (await post(AI_TWIN_LOOKUP_PATH, choice)).json()).toEqual({ lesson: two.lessons![0], match: "semantic" });
    expect(read()).toContain(canonical);
    expect(read()).not.toContain(answer);
    expect(read()).not.toContain("Câu hỏi riêng chỉ được tra nội bộ");
    expect(read()).not.toContain("Phí hủy là -10 đúng không?");
    const before = read();
    expect(await (await post(AI_TWIN_LOOKUP_PATH, { ...choice, question: "Phí hủy là +10 đúng không?" })).json()).toEqual({ lesson: null });
    expect(read()).toBe(before);
    expect(await (await post(AI_TWIN_LOOKUP_PATH, { ...choice, question: "Khi nào chốt lịch họp?" })).json()).toEqual({ lesson: null });
    expect((await post(AI_TWIN_LOOKUP_PATH, { ...choice, key: randomUUID() })).status).toBe(409);
    expect(await (await post(AI_TWIN_PREVIEW_PATH, { ...choice, useMemory: true })).json()).toEqual({
      draft: "Chúng tôi hoàn tiền trong hai ngày.", lesson: two.lessons![0], match: "semantic",
    });
    expect(read().split("\n").filter(line => line.includes(answer))).toHaveLength(1);
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 90_000);

it("learns writing habits only from selected private chat rows and revokes by revision", async () => {
  const { fixture, url, owner, call } = await launchTwin();
  try {
    const request = async (path: string, method = "GET", body?: unknown) => fetch(url + path, {
      method, headers: { ...owner, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const { creationEpoch } = await (await call()).json() as AiTwinView;
    const view = await (await call("POST", { name: "Twin", creationEpoch, creationId: randomUUID(), createConsent: true })).json() as AiTwinView;
    const named = async (name: string) => {
      const response = await request("/api/bots", "POST", { name });
      expect(response.status).toBe(201);
      return (await response.json() as { bot: { id: string; threadId: string } }).bot;
    };
    const selected = await named("Approved chat");
    const excluded = await named("Other chat");
    const send = async (bot: typeof selected, text: string) => {
      const response = await request(`/api/bots/${bot.id}/messages`, "POST", { text, threadId: bot.threadId, sendId: randomUUID() });
      expect(response.status).toBe(202);
    };
    await send(selected, "Mình thường gửi báo giá sau cuộc họp.");
    await send(selected, "Tôi có thể nhờ bạn ghi chú cuộc họp?");
    await send(selected, "Báo cáo nội bộ được gửi vào thứ Sáu.");
    const faq = { question: "Khi nào chốt sổ?", answer: "Chốt sổ vào trưa thứ Sáu." };
    await send(selected, `Hỏi: ${faq.question}\nĐáp: ${faq.answer}`);
    await send(selected, "Liên hệ fixture@example.test để nhận dữ liệu.");
    await send(excluded, "Nội dung riêng từ cuộc trò chuyện khác.");
    const learning = () => request(AI_TWIN_LEARNING_PATH).then(r => r.json() as Promise<AiTwinLearningView>);
    expect((await learning()).examples).toEqual([]);
    const version = { id: view.twin!.id, revision: view.twin!.revision };
    const enabled = await request(AI_TWIN_LEARNING_PATH, "PATCH", { ...version, thread: selected.threadId, enabled: true });
    expect(enabled.status).toBe(200);
    const learned = await enabled.json() as AiTwinView;
    await expect.poll(async () => (await learning()).style?.samples, { timeout: 20_000 }).toBe(4);
    const learnedStyles = await learning();
    expect(learnedStyles.examples.map(entry => entry.text)).toEqual([
      faq.answer, "Báo cáo nội bộ được gửi vào thứ Sáu.", "Mình thường gửi báo giá sau cuộc họp.",
    ]);
    const candidate = learnedStyles.examples[0]!;
    expect(candidate).toMatchObject({ thread: selected.threadId, question: faq.question });
    expect(JSON.stringify(learnedStyles.examples)).not.toContain("fixture@example.test");
    expect(JSON.stringify(learnedStyles.examples)).not.toContain("Nội dung riêng");
    const stored = readFileSync(join(fixture.info.dataDir, AI_TWIN_PRIVATE_DIR, "profile.json"), "utf8");
    expect(stored).not.toContain("Báo cáo nội bộ");
    expect(stored).not.toContain(faq.answer);
    const lessonFromExample = {
      ...faq,
      example: { thread: candidate.thread, message: candidate.message },
      saveAsLesson: true,
    };
    const approved = await request(AI_TWIN_LESSONS_PATH, "POST", {
      ...version, revision: learned.twin!.revision, ...lessonFromExample,
    });
    expect(approved.status).toBe(200);
    const approvedView = await approved.json() as AiTwinView;
    expect(approvedView.lessons).toEqual([expect.objectContaining({ ...faq, source: "owner" })]);
    expect(approvedView.lessons?.[0]).not.toHaveProperty("allowProvider");
    expect((await request(AI_TWIN_LEARNING_PATH, "PATCH", { ...version, thread: selected.threadId, enabled: false })).status).toBe(409);
    const revoked = await request(AI_TWIN_LEARNING_PATH, "PATCH", {
      ...version, revision: approvedView.twin!.revision, thread: selected.threadId, enabled: false,
    });
    expect(revoked.status).toBe(200);
    const revokedView = await revoked.json() as AiTwinView;
    const blockedSave = await request(AI_TWIN_LESSONS_PATH, "POST", {
      ...version, revision: revokedView.twin!.revision, ...lessonFromExample, question: "Một bài học sao chép từ nguồn đã thu hồi?",
    });
    expect(blockedSave.status).toBe(409);
    expect(revokedView.lessons).toEqual(approvedView.lessons);
    expect(await learning()).toMatchObject({ examples: [] });
    expect((await learning()).style).toBeUndefined();
  } finally {
    await fixture.close();
  }
}, 90_000);

it("publishes only explicitly released answers in the approved room and revokes on lesson edit", async () => {
  const { fixture, url, owner, call } = await launchTwin();
  try {
    const request = async (path: string, method = "GET", body?: unknown) => fetch(url + path, {
      method, headers: { ...owner, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const { creationEpoch } = await (await call()).json() as AiTwinView;
    const view = await (await call("POST", { name: "Twin", creationEpoch, creationId: randomUUID(), createConsent: true })).json() as AiTwinView;
    const question = "Khi nào họp nhóm?";
    const answer = "Câu trả lời nhóm giả lập: chiều thứ Sáu.";
    const taught = await (await request(AI_TWIN_LESSONS_PATH, "POST", {
      id: view.twin!.id, revision: view.twin!.revision, question, answer, saveAsLesson: true,
    })).json() as AiTwinView;
    const bot = await (await request("/api/bots", "POST", { name: "Participant fixture" })).json() as { bot: { id: string } };
    async function room(name: string) {
      const made = await request("/api/groups", "POST", { name, memberIds: [bot.bot.id], defaultResponder: { kind: "mentions" } });
      expect(made.status).toBe(201);
      const { group } = await made.json() as { group: { id: string; threadId: string } };
      const setup = await request(`/api/groups/${group.id}/setup`, "PATCH", {
        action: "complete", cwd: null, bulletin: "", defaultResponder: { kind: "mentions" },
      });
      expect(setup.status).toBe(200);
      return group;
    }
    const approved = await room("Approved fixture group");
    const other = await room("Other fixture group");
    const version = { id: taught.twin!.id, revision: taught.twin!.revision };
    const grant = await request(AI_TWIN_DELEGATION_PATH, "PATCH", { ...version, room: approved.id, lesson: taught.lessons![0]!.id, enabled: true });
    expect(grant.status).toBe(200);
    const granted = await grant.json() as AiTwinView;
    const send = (room: typeof approved, text: string, sendId = randomUUID()) =>
      request(`/api/groups/${room.id}/messages`, "POST", { text, sendId, threadId: room.threadId });
    const messages = async (group: typeof approved) => {
      const body = await (await request(`/api/threads/${group.threadId}/messages`)).json() as {
        messages: Array<{ id: string; text?: string; from?: { botId: string; name: string }; replyToId?: string; sendId?: string }>;
      };
      return body.messages;
    };
    const replies = async (group: typeof approved) => (await messages(group)).filter(line => line.from?.botId === "ai-twin");
    expect((await send(other, "@AI Twin " + question)).status).toBe(202);
    expect(await replies(other)).toEqual([]);
    expect((await send(approved, question)).status).toBe(202);
    expect(await replies(approved)).toEqual([]);
    const sendId = randomUUID();
    const sent = await send(approved, "@AI Twin " + question, sendId);
    expect(sent.status).toBe(202);
    await expect.poll(async () => (await replies(approved)).length, { timeout: 15_000 }).toBe(1);
    const message = (await messages(approved)).find((line) => line.sendId === sendId)!;
    expect(message).toBeDefined();
    const replayed = await send(approved, "@AI Twin " + question, sendId);
    expect(replayed.status).toBe(202);
    expect(await replayed.json()).toMatchObject({ message: { id: message.id } });
    expect(await replies(approved)).toEqual([expect.objectContaining({ text: answer, replyToId: message.id, from: expect.objectContaining({ name: "AI Twin" }) })]);

    const edit = await request(AI_TWIN_LESSONS_PATH, "POST", {
      ...version, revision: granted.twin!.revision, lessonId: taught.lessons![0]!.id, question, answer: "Mốc mới chỉ dùng riêng.", saveAsLesson: true,
    });
    expect(edit.status).toBe(200);
    expect((await edit.json() as AiTwinView).controls?.delegations).toEqual([]);
    expect((await send(approved, "@AI Twin " + question)).status).toBe(202);
    expect(await replies(approved)).toHaveLength(1);
  } finally {
    await fixture.close();
  }
}, 90_000);

it("gives an opted-in companion only the private lookup and draft routes, then closes access on revocation", async () => {
  const { fixture, url, owner, phone, call } = await launchTwin();
  try {
    const { creationEpoch } = await (await call()).json() as AiTwinView;
    const made = await (await call("POST", { name: "Fixture", creationEpoch, creationId: randomUUID(), createConsent: true })).json() as AiTwinView;
    const request = (path: string, method: string, body: object, headers: Record<string, string> = owner) => fetch(url + path, {
      method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const version = { id: made.twin!.id, revision: made.twin!.revision };
    expect((await call("GET", undefined, phone)).status).toBe(404);
    const enabled = await request(AI_TWIN_PHONE_PATH, "PATCH", { ...version, enabled: true });
    expect(enabled.status).toBe(200);
    const current = await enabled.json() as AiTwinView;
    const read = await call("GET", undefined, phone);
    expect(read.status).toBe(200);
    const mobile = await read.json() as AiTwinView;
    expect(mobile.twin?.name).toBe("Fixture");
    expect(mobile).not.toHaveProperty("lessons");
    expect(mobile).not.toHaveProperty("controls");
    const next = { ...version, revision: current.twin!.revision };
    expect(await (await request(AI_TWIN_LOOKUP_PATH, "POST", { ...next, question: "A question" }, phone)).json()).toEqual({ lesson: null });
    expect((await request(AI_TWIN_PHONE_PATH, "PATCH", { ...next, enabled: false }, phone)).status).toBe(403);
    expect((await call("GET", undefined, { ...phone, "x-openmausbot-companion-auth": "fake" })).status).toBe(403);
    expect((await request(AI_TWIN_PHONE_PATH, "PATCH", { ...next, enabled: false })).status).toBe(200);
    expect((await call("GET", undefined, phone)).status).toBe(404);
  } finally {
    await fixture.close();
  }
}, 90_000);

it("drops semantic recall when the lesson is forgotten while the provider is running", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-twin-revoke-"));
  const log = join(scratch, "calls.jsonl");
  const { fixture, url, owner, call } = await launchTwin({ FAKE_CLAUDE_TEXT_LOG: log, FAKE_CLAUDE_TEXT_HANG: "1", FAKE_CLAUDE_VERSION: "2.1.321" });
  try {
    const { creationEpoch } = await (await call()).json() as AiTwinView;
    const { twin } = await (await call("POST", { name: "Twin", creationEpoch, creationId: randomUUID(), createConsent: true })).json() as AiTwinView;
    const request = (path: string, method: string, data: unknown) => fetch(url + path, {
      method, headers: { ...owner, "content-type": "application/json" }, body: JSON.stringify(data),
    });
    const saved = await (await request(AI_TWIN_LESSONS_PATH, "POST", {
      id: twin!.id, revision: twin!.revision, question: "When is the invoice due?", answer: "Private fixture answer.", saveAsLesson: true, allowProvider: true,
    })).json() as AiTwinView;
    const version = { id: twin!.id, revision: saved.twin!.revision };
    const query = "What is the invoice due date?";
    const pending = request(AI_TWIN_LOOKUP_PATH, "POST", { ...version, question: query, key: saved.preview!.key, useProvider: true });
    await expect.poll(() => existsSync(log) && readFileSync(log, "utf8").includes(query), { timeout: 10_000 }).toBe(true);
    expect((await request(AI_TWIN_LESSONS_PATH, "DELETE", { ...version, lessonId: saved.lessons![0]!.id })).status).toBe(200);
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Private fixture answer.");
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 90_000);
