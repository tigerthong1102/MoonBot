import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import { applyPendingWorkspaceRestore, commitPendingWorkspaceRestore, createWorkspaceBackup, stageWorkspaceBackup } from "../workspace-backup.ts";
import { createZaloInbox } from "../zalo-inbox.ts";
import { createZaloWebhookPilot } from "../zalo-webhook.ts";
import { createZaloErasureRoutes } from "./zalo-erasure.ts";

const owner: RequestAuth = { kind: "loopback", desktopOwner: true, scopes: ["admin"] };
const password = "synthetic workspace backup password";
let home: string;
let db: DatabaseSync;
beforeEach(() => {
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT", "1");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID", "fixture-bot");
  home = mkdtempSync(join(tmpdir(), "zalo-erasure-"));
  const dir = join(home, ".startupbot-qualification", "zalo-official");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "inbox.sqlite");
  db = new DatabaseSync(file); chmodSync(file, 0o600);
});
afterEach(() => { db.close(); rmSync(home, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function seed() {
  const start = Date.now() - 60_000;
  const inbox = createZaloInbox(db, () => start - 1);
  const pilot = createZaloWebhookPilot(db);
  function connect(accountId: string) {
    const bot = pilot.register(accountId);
    const scope = { accountId, adapter: "official" as const, conversationId: "chat", conversationType: "direct" as const, senderId: "sender" };
    const grant = inbox.enroll({ ...scope, retentionDays: 2 });
    db.prepare("UPDATE zalo_webhook_endpoints SET grantId=? WHERE accountId=?").run(grant, accountId);
    const event = { ...scope, messageId: "first", text: "synthetic private text", timestamp: start, direction: "incoming" as const };
    expect(inbox.accept(event, grant)).toBe("persisted");
    return { bot, grant, event };
  }
  const source = connect("fixture-bot"), other = connect("unrelated");
  const range = { revision: pilot.inspect("fixture-bot")!.status.revision, start, end: start + 100 };
  return { inbox, source, other, range, pilot };
}
async function call(input: object, auth = owner, local = true) {
  const req = new IncomingMessage(new Socket()), res = new ServerResponse(req);
  req.headers["content-type"] = "application/json";
  const path = "/api/zalo-official/erasure";
  let status = 0;
  let data: { count?: number; confirmation?: string; erased?: number; coverage?: { count: number } } = {};
  await createZaloErasureRoutes(local, () => home)({ req, res, path, method: "POST", url: new URL(path, "http://localhost"), auth,
    readBody: async () => input, json: (_res, code, value) => { status = code; data = value as typeof data; } });
  expect(res.getHeader("cache-control")).toBe("no-store");
  return { status, data };
}

it("binds a confirmed interval to exactly the previewed rows and grant, leaving neighboring rows and another account available", async () => {
  const { inbox, source, other, range, pilot } = seed();
  const preview = { action: "preview", ...range };
  for (const input of [{ ...preview, end: range.start - 1 }, { ...preview, end: Date.now() + 5000 }, { ...preview, accountId: "unrelated" }])
    expect((await call(input)).status).toBe(400);
  expect((await call(preview, { kind: "loopback", scopes: ["admin"] })).status).toBe(403);
  expect((await call(preview, owner, false)).status).toBe(403);
  const first = await call(preview);
  expect(Object.keys(first.data).sort()).toEqual(["confirmation", "count"]);
  expect(first.data.count).toBe(1);
  const erase = { ...range, action: "erase", confirmation: first.data.confirmation };
  expect(inbox.accept({ ...source.event, messageId: "second", timestamp: range.end }, source.grant)).toBe("persisted");
  expect((await call(erase)).status).toBe(409);
  const fresh = await call(preview);
  const confirmed = { ...erase, confirmation: fresh.data.confirmation };
  expect((await call({ ...confirmed, start: range.start + 1 })).status).toBe(409);
  expect(inbox.accept({ ...source.event, messageId: "outside", timestamp: range.end + 1 }, source.grant)).toBe("persisted");
  expect(await call(confirmed)).toMatchObject({ status: 200, data: { erased: 2, coverage: { count: 1 } } });
  expect((await call(confirmed)).status).toBe(409);
  expect(inbox.accept(source.event, source.grant)).toBe("revoked");
  expect(inbox.read(other.grant)).toHaveLength(1);
  pilot.remove(pilot.inspect("fixture-bot")!.endpoint);
  pilot.register("fixture-bot");
  expect((await call(preview)).status).toBe(409);
});

it("restores a real encrypted pre-deletion workspace archive while preserving live erasure and revocation", async () => {
  const { source, other, pilot, range, inbox } = seed();
  // Deliberately choose an overlapping workspace root to exercise archive intake, export and restore.
  writeFileSync(join(home, "notes.md"), "synthetic portable note");
  const archived = await createWorkspaceBackup(home, { password });
  const preview = await call({ ...range, action: "preview" });
  expect((await call({ ...range, action: "erase", confirmation: preview.data.confirmation })).status).toBe(200);
  pilot.remove(pilot.inspect("unrelated")!.endpoint);
  writeFileSync(join(home, "notes.md"), "new");
  const staged = await stageWorkspaceBackup(home, archived.path, { password });
  const manifest = JSON.parse(readFileSync(join(home, ".backups", staged.id, "staged", "manifest.json"), "utf8"));
  expect(manifest.entries.map((e: { path: string }) => e.path)).toEqual(["notes.md"]);
  commitPendingWorkspaceRestore(home, staged.id);
  expect(applyPendingWorkspaceRestore(home).restored).toBe(true);
  expect(readFileSync(join(home, "notes.md"), "utf8")).toBe("synthetic portable note");
  expect((await call({ ...range, action: "preview" })).data.count).toBe(0);
  expect(inbox.accept(source.event, source.grant)).toBe("revoked");
  expect(inbox.accept(other.event, other.grant)).toBe("revoked");
  await expect(createWorkspaceBackup(join(home, ".startupbot-qualification", "zalo-official"), { password })).rejects.toThrow(/Private qualification/);
}, 60_000);
