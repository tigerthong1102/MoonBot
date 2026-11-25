import { createPublicKey, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ home: "", menu: null, destroyed: null }));
vi.mock("electron", () => ({
  app: { getPath: () => fixture.home },
  Menu: { buildFromTemplate: menu => { fixture.menu = menu; return { popup: () => {} }; } },
  safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async text => Buffer.from(`fixture:${text}`), decryptStringAsync: async bytes => bytes.toString().slice(8), getSelectedStorageBackend: () => "keychain" },
}));
import { personalInboxBots } from "./personal-inbox-bots.mjs";

afterEach(() => { fixture.destroyed?.(); vi.useRealTimers(); if (fixture.home) rmSync(fixture.home, { recursive: true, force: true }); });

it("registers the selected local bot through a signed cloud claim before publishing its username", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-pick-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  const room = "11111111-1111-4111-8111-111111111111", nonce = "22222222-2222-4222-8222-222222222222", workspaceId = "33333333-3333-4333-8333-333333333333";
  const origin = "https://fixture.invalid", owner = "owner-fixture";
  let anchored, sent = 0;
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { anchored = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: [{ id: "fixture-bot", name: "Fixture", ...(anchored ? { username: anchored.username } : {}) }] }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const cloudFetch = async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: owner }) };
    const body = JSON.parse(init.body);
    if (body.action === "challenge") return { ok: true, json: async () => ({ nonce }) };
    expect(body.action).toBe("invite");
    expect(anchored).toBeUndefined();
    const key = createPublicKey({ key: Buffer.from(`302a300506032b6570032100${body.proof.publicKey}`, "hex"), format: "der", type: "spki" });
    const payload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", origin, owner, body.bot, room, nonce]));
    expect(verify(null, payload, key, Buffer.from(body.proof.signature, "hex"))).toBe(true);
    sent++;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const page = { isDestroyed: () => false, session: { fetch: cloudFetch }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, origin, (endpoint, init) => localFetch(endpoint, init));
  instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  fixture.menu[0].click();
  await vi.waitFor(() => expect(anchored?.username).toMatch(/^bot_k[a-f0-9]{64}$/));
  expect(sent).toBe(1);
  expect(anchored.workspaceId).toBe(workspaceId);
});

it("does not invite or anchor when the workspace changes during the cloud challenge", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-pick-switch-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  fixture.menu = null;
  const room = "11111111-1111-4111-8111-111111111111", nonce = "22222222-2222-4222-8222-222222222222";
  let workspaceId = "33333333-3333-4333-8333-333333333333", invited = 0, anchored = 0, errors = 0;
  const localFetch = async endpoint => ({ ok: true, json: async () => endpoint.endsWith("bot-identity") ? { workspaceId } : { bots: [{ id: "fixture-bot", name: "Fixture" }] } });
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const cloudFetch = async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "owner-fixture" }) };
    if (JSON.parse(init.body).action === "challenge") {
      workspaceId = "44444444-4444-4444-8444-444444444444";
      return { ok: true, json: async () => ({ nonce }) };
    }
    invited++; return { ok: true, json: async () => ({ ok: true }) };
  };
  const page = { isDestroyed: () => false, session: { fetch: cloudFetch }, executeJavaScript: async text => { if (text.includes("inbox-bots-error")) errors++; }, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", async () => { anchored++; return { ok: true }; });
  instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  fixture.menu[0].click();
  await vi.waitFor(() => expect(errors).toBe(1));
  expect(invited).toBe(0);
  expect(anchored).toBe(0);
});

it("does not poll an unscoped legacy bot binding in an unknown workspace", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-legacy-switch-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  writeFileSync(join(fixture.home, ".startupbot", "personal-inbox-bots.json"), JSON.stringify({ "fixture-bot": { id: "11111111-1111-4111-8111-111111111111", owner: "owner-fixture", origin: "https://fixture.invalid" } }));
  let polls = 0;
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: async () => ({ ok: true, json: async () => ({ workspaceId: "44444444-4444-4444-8444-444444444444" }) }) }) };
  const page = { isDestroyed: () => false, session: { fetch: async () => { polls++; return { ok: true, json: async () => ({ jobs: [] }) }; } }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  vi.useFakeTimers();
  personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", async () => ({ ok: true }));
  await vi.advanceTimersByTimeAsync(8000);
  expect(polls).toBe(0);
});

it("keeps a scoped legacy invite working when the cloud does not support challenges", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-legacy-cloud-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot")); fixture.menu = null;
  const room = "11111111-1111-4111-8111-111111111111", workspaceId = "33333333-3333-4333-8333-333333333333";
  let invited = 0, anchored = 0, changed = 0;
  const localFetch = async endpoint => ({ ok: true, json: async () => endpoint.endsWith("bot-identity") ? { workspaceId } : { bots: [{ id: "fixture-bot", name: "Fixture" }] } });
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const page = { isDestroyed: () => false, session: { fetch: async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "owner-fixture" }) };
    const body = JSON.parse(init.body);
    if (body.action === "challenge") return { ok: false, status: 400 };
    expect(body.action).toBe("invite"); expect(body.username).toBeUndefined(); invited++;
    return { ok: true, json: async () => ({ ok: true }) };
  } }, executeJavaScript: async text => { if (text.includes("inbox-bots-changed")) changed++; }, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", async () => { anchored++; return { ok: true }; });
  instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  fixture.menu[0].click();
  await vi.waitFor(() => expect(changed).toBe(1));
  expect(invited).toBe(1);
  expect(anchored).toBe(0);
});
