import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AI_TWIN_PRIVATE_DIR, createAiTwinStore } from "../ai-twin.ts";
import { localStyleExample, ZALO_OWNER_STYLE_PATH } from "../../shared/zalo-owner-style.ts";
import { json, parsedBodyOf, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createOwnerStyleRoutes } from "./ai-twin-owner-style.ts";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "twin-style-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = createAiTwinStore(dir, "local-fixture");
  const twin = store.create({ name: "Test", creationEpoch: "initial", creationId: randomUUID(), createConsent: true }).view.twin!;
  let clock = Date.now(), blocked = false, hostOwner = true;
  const owner: RequestAuth = { kind: "loopback", desktopOwner: true, scopes: ["admin"] };
  let auth: RequestAuth = owner;
  const route = createOwnerStyleRoutes({ store, now: () => clock, owner: () => hostOwner, blocked: () => blocked, cancelDrafts: () => {} });
  const bodies: unknown[] = [];
  const app = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    await route({ req, res, url, path: url.pathname, method: req.method!, auth, json, readBody });
    bodies.push(parsedBodyOf(req));
  });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  cleanup.push(() => new Promise<void>(resolve => app.close(() => resolve())));
  const a = app.address(); if (!a || typeof a === "string") throw Error();
  const url = "http://127.0.0.1:" + a.port + ZALO_OWNER_STYLE_PATH;
  const call = (input?: object) => fetch(url, input ? { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: twin.id, revision: store.get().twin?.revision, ...input }) } : {});
  const sample = "Dạ, em đã nhận yêu cầu đóng gói tranh. Bạn tiện trao đổi tiếp khi nào?";
  const propose = { action: "propose", authorConsent: true, provenance: "owner-desktop-editor", sample };
  return { dir, store, twin, call, sample, propose, bodies, owner, principal: (v: RequestAuth) => { auth = v; },
    allow: (v: boolean) => { hostOwner = v; }, busy: (v: boolean) => { blocked = v; }, expire: () => { clock += 300_001; } };
}
async function proposal(response: Promise<Response>) {
  const p = await response; expect(p.status).toBe(200); return await p.json() as { proposalId: string; traits: string[] };
}

it("keeps only the edited descriptors, reads them back after restart, and keeps all raw samples and traits outside provider/room views", async () => {
  const f = await fixture();
  const p = await proposal(f.call(f.propose));
  expect(p.traits).toEqual(["brief", "question", "polite", "em"]);
  const approved = { action: "approve", proposalId: p.proposalId, approveConsent: true, traits: ["em", "polite"] };
  expect((await f.call({ ...approved, traits: ["list"] })).status).toBe(400);
  expect((await f.call(approved)).status).toBe(200);
  expect((await f.call(approved)).status).toBe(409);
  const saved = await f.call();
  expect(saved.headers.get("cache-control")).toBe("private, no-store");
  expect(await saved.json()).toMatchObject({ approved: { provenance: "owner-desktop-editor", traits: ["polite", "em"] } });
  const copy = createAiTwinStore(f.dir, "local-fixture");
  const v = copy.get();
  expect(copy.ownerEditorStyle(v.twin!)).toMatchObject({ traits: ["polite", "em"] });
  expect(v.twin!.style).toBe("");
  expect(v.lessons).toEqual([]);
  expect(JSON.stringify(v)).not.toContain("owner-desktop-editor");
  expect(copy.roomReply("fixture-room", f.sample)).toBeUndefined();
  expect(localStyleExample(["polite", "em"])).toContain("Dạ, em đã nhận");
  expect(readFileSync(join(f.dir, AI_TWIN_PRIVATE_DIR, "profile.json"), "utf8")).not.toContain(f.sample);
  expect(JSON.stringify(f.bodies)).not.toContain(f.sample);
  expect(() => createAiTwinStore(f.dir, "different").get()).toThrow();
  const value = copy.get().twin!;
  copy.update({ ...value, name: value.name, style: value.style, paused: true });
  expect((await f.call(f.propose)).status).toBe(409);
  expect((await f.call({ action: "forget" })).status).toBe(200);
  expect(await (await f.call()).json()).toMatchObject({ paused: true, approved: null });
  expect(readFileSync(join(f.dir, AI_TWIN_PRIVATE_DIR, "profile.json"), "utf8")).not.toContain("owner-desktop-editor");
});

it("requires the trusted local owner and a new, explicitly attested sample and refuses private identifiers or an imported origin", async () => {
  const f = await fixture();
  for (const auth of [{ kind: "loopback", scopes: ["admin"] }, { ...f.owner, trust: "service" }, { ...f.owner, companionDevice: "phone" }] as RequestAuth[]) {
    f.principal(auth); expect((await f.call()).status).toBe(404); expect((await f.call(f.propose)).status).toBe(404);
  }
  f.principal(f.owner); f.allow(false); expect((await f.call(f.propose)).status).toBe(404);
  f.allow(true);
  for (const changed of [{ provenance: undefined }, { provenance: "inbox" }, { provenance: "ai-draft" }, { authorConsent: false },
    { thread: "history" }, { messageId: "source" }]) expect((await f.call({ ...f.propose, ...changed })).status).toBe(400);
  for (const sample of ["Dạ, em gửi mã 123456.", "Em dùng john@example.invalid ở đây.", "Em sẽ gửi mật khẩu."]) {
    expect((await f.call({ ...f.propose, sample })).status).toBe(422);
  }
  f.busy(true); expect((await f.call(f.propose)).status).toBe(409);
  expect(f.store.ownerEditorStyle(f.twin)).toBeUndefined();
});

it("invalidates declined, replaced, expired and stale-revision proposals and deletes style with its Twin", async () => {
  const f = await fixture();
  const action = (proposalId: string) => f.call({ action: "approve", proposalId, approveConsent: true, traits: ["brief"] });
  const a = await proposal(f.call(f.propose)), b = await proposal(f.call(f.propose));
  expect((await action(a.proposalId)).status).toBe(409);
  expect((await f.call({ action: "decline", proposalId: b.proposalId })).status).toBe(200);
  expect((await action(b.proposalId)).status).toBe(409);
  const c = await proposal(f.call(f.propose)); f.expire();
  expect((await action(c.proposalId)).status).toBe(409);
  const d = await proposal(f.call(f.propose));
  f.store.update({ ...f.twin, paused: false, name: "Changed", style: "" });
  expect((await action(d.proposalId)).status).toBe(409);
  const e = await proposal(f.call(f.propose));
  expect((await action(e.proposalId)).status).toBe(200);
  f.store.delete(f.store.get().twin!);
  expect((await f.call()).status).toBe(409);
  expect(readFileSync(join(f.dir, AI_TWIN_PRIVATE_DIR, "profile.json"), "utf8")).not.toContain("owner-desktop-editor");
});
