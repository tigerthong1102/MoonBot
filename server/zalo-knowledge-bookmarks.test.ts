import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import {
  type ZaloKnowledgeItem, ZALO_PRIVATE_KNOWLEDGE_MARKER as marker,
  ZALO_PRIVATE_KNOWLEDGE_PATH as path,
} from "../shared/zalo-knowledge-bookmarks.ts";
import { json, readBody } from "./harness/http.ts";
import { createZaloKnowledgeRoutes } from "./routes/zalo-knowledge-bookmarks.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createZaloInbox } from "./zalo-inbox.ts";
import { zaloKnowledgeBookmarks } from "./zalo-knowledge-bookmarks.ts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
  vi.unstubAllEnvs();
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "zalo-knowledge-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, ".startupbot-qualification", "zalo-official");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "inbox.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  cleanup.push(() => db.close());
  const time = Date.now();
  const inbox = createZaloInbox(db, () => time);
  const scope = {
    adapter: "official",
    accountId: "bot",
    senderId: "sender",
    conversationId: "chat",
    conversationType: "direct",
  } as const;
  const grantId = inbox.enroll({ ...scope, retentionDays: 1 });
  db.prepare(
    "INSERT INTO zalo_webhook_endpoints(endpoint,accountId,secretHash,grantId) VALUES('endpoint','bot',randomblob(32),?)",
  ).run(grantId);
  function ingest(id: string, text: string) {
    expect(inbox.accept({ ...scope, messageId: id, direction: "incoming", timestamp: time, text }, grantId)).toBe(
      "persisted",
    );
  }
  ingest("source", marker + "\nTra cứu hạn bảo hành 17 ngày.");
  ingest("not-consented", "Tra cứu hạn bảo hành bí mật.");
  ingest("inline", "Người khác bảo " + marker + "\nKhông đề xuất.");
  ingest("secret", marker + "\nsk-proj-" + "x".repeat(50));
  return { home, file, db, time, grantId, inbox };
}
it("requires a sender proposal and owner action; retired approvals cannot resurrect a forgotten bookmark", () => {
  const { db, file, time, grantId, inbox } = fixture();
  const shelf = zaloKnowledgeBookmarks(db, "bot", "owner-space", () => time);
  const list = shelf.list();
  expect(list).toHaveLength(1);
  const row = list[0]!;
  expect(row).toMatchObject({ saved: false, sourceId: "source", grantId, senderId: "sender" });
  expect(shelf.choose({ ...row, save: true })).toBe(true);
  const other = new DatabaseSync(file);
  try {
    const reopened = zaloKnowledgeBookmarks(other, "bot", "owner-space", () => time);
    const saved = reopened.list()[0]!;
    expect(saved.saved).toBe(true);
    expect(zaloKnowledgeBookmarks(other, "other", "owner-space", () => time).list()).toEqual([]);
    expect(reopened.choose({ ...saved, save: false })).toBe(true);
    expect(reopened.choose({ ...row, save: true })).toBe(false);
    expect(reopened.list()[0]!.saved).toBe(false);
    expect(zaloKnowledgeBookmarks(other, "bot", "owner-space", () => time + 86_400_001).list()).toEqual([]);
    expect(inbox.eraseInterval(grantId, time, time)).toBe(4);
    expect(reopened.choose({ ...saved, save: true })).toBe(false);
    expect(reopened.list()).toEqual([]);
    expect(other.prepare("SELECT COUNT(*) AS rows FROM zalo_knowledge_bookmarks").get()).toMatchObject({ rows: 0 });
  } finally {
    other.close();
  }
});
it("serves only the pinned workspace's desktop owner and rechecks the source for every decision", async () => {
  const f = fixture();
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "bot");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_PRIVATE_KNOWLEDGE", "1");
  vi.stubEnv("STARTUPBOT_ZALO_KNOWLEDGE_WORKSPACE", "owner");
  let workspace = "other",
    auth: RequestAuth = { kind: "loopback", scopes: ["admin"], desktopOwner: true };
  const route = createZaloKnowledgeRoutes(
    true,
    () => f.home,
    () => workspace,
  );
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    await route({ req, res, url, path: url.pathname, method: req.method!, auth, json, readBody });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("fixture port");
  const endpoint = "http://127.0.0.1:" + addr.port + path;
  const approve = (body: unknown) =>
    fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await fetch(endpoint)).status).toBe(403);
  workspace = "owner";
  const reply = await fetch(endpoint);
  expect(reply.headers.get("cache-control")).toContain("no-store");
  const { items } = (await reply.json()) as { items: ZaloKnowledgeItem[] };
  expect(items).toHaveLength(1);
  const { sourceId, grantId, revision } = items[0]!;
  expect((await approve({ sourceId, grantId, revision, save: true })).status).toBe(400);
  expect((await approve({ sourceId, grantId, revision, save: true, reviewed: true })).status).toBe(200);
  f.inbox.revoke(grantId);
  expect((await approve({ sourceId, grantId, revision, save: true, reviewed: true })).status).toBe(409);
  expect(await (await fetch(endpoint)).json()).toEqual({ items: [] });
  auth = { kind: "loopback", scopes: ["admin"] };
  expect((await fetch(endpoint)).status).toBe(403);
});
