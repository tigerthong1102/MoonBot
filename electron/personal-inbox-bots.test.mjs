import { createPublicKey, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ home: "", menu: null, destroyed: null, response: 0 }));
vi.mock("electron", () => ({
  app: { getPath: () => fixture.home },
  dialog: { showMessageBox: async () => ({ response: fixture.response }) },
  Menu: { buildFromTemplate: menu => { fixture.menu = menu; return { popup: () => {} }; } },
  safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async text => Buffer.from(`fixture:${text}`), decryptStringAsync: async bytes => bytes.toString().slice(8), getSelectedStorageBackend: () => "keychain" },
}));
import { personalInboxBots } from "./personal-inbox-bots.mjs";

afterEach(() => { fixture.destroyed?.(); fixture.response = 0; vi.useRealTimers(); if (fixture.home) rmSync(fixture.home, { recursive: true, force: true }); });

it("registers same-name bots before selection without joining a room", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-pick-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  const room = "11111111-1111-4111-8111-111111111111", nonce = "22222222-2222-4222-8222-222222222222", workspaceId = "33333333-3333-4333-8333-333333333333";
  const origin = "https://fixture.invalid", owner = "owner-fixture";
  const anchored = new Map(); let registered = 0, sent = 0;
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { const value = JSON.parse(init.body); anchored.set(value.id, value); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: ["fixture-bot", "fixture-bot-two"].map(id => ({ id, name: "Fixture", ...(anchored.has(id) ? { username: anchored.get(id).username } : {}) })) }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const cloudFetch = async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: owner }) };
    const body = JSON.parse(init.body);
    if (body.action === "challenge") return { ok: true, json: async () => ({ nonce }) };
    expect(["register", "invite"]).toContain(body.action);
    const key = createPublicKey({ key: Buffer.from(`302a300506032b6570032100${body.proof.publicKey}`, "hex"), format: "der", type: "spki" });
    const scope = body.action === "register" ? "00000000-0000-4000-8000-000000000000" : room;
    const payload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", origin, owner, body.bot, scope, nonce]));
    expect(verify(null, payload, key, Buffer.from(body.proof.signature, "hex"))).toBe(true);
    if (body.action === "register") registered++; else sent++;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const page = { isDestroyed: () => false, session: { fetch: cloudFetch }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, origin, (endpoint, init) => localFetch(endpoint, init));
  instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(2));
  expect(registered).toBe(2);
  expect(sent).toBe(0);
  expect(fixture.menu[0].label).toMatch(/^Fixture \(@bot_k[a-f0-9]{64}\)$/);
  expect(fixture.menu[1].label).toMatch(/^Fixture \(@bot_k[a-f0-9]{64}\)$/);
  expect(fixture.menu[0].label).not.toBe(fixture.menu[1].label);
  fixture.menu[0].click();
  await vi.waitFor(() => expect(sent).toBe(1));
  expect(anchored.get("fixture-bot").workspaceId).toBe(workspaceId);
});

it("does not invite the same bot ID from a different workspace after the menu opens", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-pick-switch-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  fixture.menu = null;
  const room = "11111111-1111-4111-8111-111111111111", nonce = "22222222-2222-4222-8222-222222222222";
  let workspaceId = "33333333-3333-4333-8333-333333333333", invited = 0, anchored, errors = 0;
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { anchored = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: [{ id: "fixture-bot", name: "Fixture", ...(anchored ? { username: anchored.username } : {}) }] }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const cloudFetch = async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "owner-fixture" }) };
    const action = JSON.parse(init.body).action;
    if (action === "challenge") return { ok: true, json: async () => ({ nonce }) };
    if (action === "invite") invited++;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const page = { isDestroyed: () => false, session: { fetch: cloudFetch }, executeJavaScript: async text => { if (text.includes("inbox-bots-error")) errors++; }, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", (endpoint, init) => localFetch(endpoint, init));
  instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  expect(fixture.menu[0].enabled).toBe(true);
  workspaceId = "44444444-4444-4444-8444-444444444444";
  fixture.menu[0].click();
  await vi.waitFor(() => expect(errors).toBe(1));
  expect(invited).toBe(0);
  expect(anchored.workspaceId).toBe("33333333-3333-4333-8333-333333333333");
});

it("does not open a stale menu when the workspace changes while identities register", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-menu-switch-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot")); fixture.menu = null;
  let workspaceId = "33333333-3333-4333-8333-333333333333", joined = 0, saved = 0, errors = 0;
  const localFetch = async endpoint => ({ ok: true, json: async () => endpoint.endsWith("bot-identity") ? { workspaceId } : { bots: [{ id: "fixture-bot", name: "Fixture" }] } });
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const page = { isDestroyed: () => false, session: { fetch: async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "owner-fixture" }) };
    if (JSON.parse(init.body).action === "challenge") { workspaceId = "44444444-4444-4444-8444-444444444444"; return { ok: true, json: async () => ({ nonce: "22222222-2222-4222-8222-222222222222" }) }; }
    joined++; return { ok: true, json: async () => ({ ok: true }) };
  } }, executeJavaScript: async text => { if (text.includes("inbox-bots-error")) errors++; }, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", async () => { saved++; return { ok: true }; });
  instance.invite("11111111-1111-4111-8111-111111111111");
  await vi.waitFor(() => expect(errors).toBe(1));
  expect(fixture.menu).toBeNull();
  expect(joined).toBe(0);
  expect(saved).toBe(0);
});

it("does not poll an unscoped legacy bot binding in an unknown workspace", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-legacy-switch-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  writeFileSync(join(fixture.home, ".startupbot", "personal-inbox-bots.json"), JSON.stringify({ "fixture-bot": { id: "11111111-1111-4111-8111-111111111111", owner: "owner-fixture", origin: "https://fixture.invalid" } }));
  let polls = 0;
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: async () => ({ ok: true, json: async () => ({ workspaceId: "44444444-4444-4444-8444-444444444444" }) }) }) };
  const page = { isDestroyed: () => false, session: { fetch: async url => { if (url.endsWith("/bot-turns")) polls++; return { ok: true, json: async () => ({ jobs: [] }) }; } }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  vi.useFakeTimers();
  personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", async () => ({ ok: true }));
  await vi.advanceTimersByTimeAsync(8000);
  expect(polls).toBe(0);
});

it("does not present a fabricated username when the cloud cannot register it", async () => {
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
  expect(fixture.menu[0].enabled).toBe(false);
  expect(fixture.menu[0].label).toBe("Fixture (…)");
  expect(changed).toBe(0);
  expect(invited).toBe(0);
  expect(anchored).toBe(0);
});

it("uses an honest local ID to select a bot when the older cloud supports only signed invitations", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-old-cloud-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot")); fixture.menu = null;
  const room = "11111111-1111-4111-8111-111111111111", workspaceId = "33333333-3333-4333-8333-333333333333", nonce = "22222222-2222-4222-8222-222222222222";
  let anchored, sent = 0;
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { anchored = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: [{ id: "fixture-bot", name: "Fixture", ...(anchored ? { username: anchored.username } : {}) }] }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const origin = "https://fixture.invalid", owner = "owner-fixture";
  const page = { isDestroyed: () => false, session: { fetch: async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: owner }) };
    if (url.endsWith("/bot-identities")) return { ok: false, status: 404 };
    const input = JSON.parse(init.body);
    if (input.action === "challenge") return { ok: true, json: async () => ({ nonce }) };
    expect(input.action).toBe("invite");
    const key = createPublicKey({ key: Buffer.from(`302a300506032b6570032100${input.proof.publicKey}`, "hex"), format: "der", type: "spki" });
    const payload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", origin, owner, input.bot, room, nonce]));
    expect(verify(null, payload, key, Buffer.from(input.proof.signature, "hex"))).toBe(true);
    sent++; return { ok: true, json: async () => ({ ok: true }) };
  } }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, origin, (endpoint, init) => localFetch(endpoint, init));
  instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  expect(fixture.menu[0].label).toBe("Fixture (ID: fixture-bot)");
  expect(fixture.menu[0].enabled).toBe(true);
  expect(sent).toBe(0);
  fixture.menu[0].click();
  await vi.waitFor(() => expect(anchored?.username).toMatch(/^bot_k[a-f0-9]{64}$/));
  expect(sent).toBe(1);
});

it("retries identity registration after offline recovery without joining a group", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-identity-retry-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  const workspaceId = "33333333-3333-4333-8333-333333333333", nonce = "22222222-2222-4222-8222-222222222222";
  let offline = true, anchored, registered = 0, invited = 0;
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { anchored = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: [{ id: "fixture-bot", name: "Fixture", ...(anchored ? { username: anchored.username } : {}) }] }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const page = { isDestroyed: () => false, session: { fetch: async (url, init) => {
    if (offline) throw Error("fixture_offline");
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "owner-fixture" }) };
    if (url.endsWith("/bot-turns")) return { ok: true, json: async () => ({ jobs: [] }) };
    const input = JSON.parse(init.body);
    if (input.action === "challenge") return { ok: true, json: async () => ({ nonce }) };
    if (input.action === "register") registered++; else invited++;
    return { ok: true, json: async () => ({ ok: true }) };
  } }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  vi.useFakeTimers();
  personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", (endpoint, init) => localFetch(endpoint, init));
  await vi.advanceTimersByTimeAsync(8000);
  expect(registered).toBe(0);
  offline = false;
  await vi.advanceTimersByTimeAsync(40_000);
  expect(registered).toBe(1);
  expect(anchored?.username).toMatch(/^bot_k[a-f0-9]{64}$/);
  expect(invited).toBe(0);
});

it("continues registering later bots when the first bot has a permanent conflict", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-identity-conflict-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot"));
  const workspaceId = "33333333-3333-4333-8333-333333333333", nonce = "22222222-2222-4222-8222-222222222222";
  const anchors = new Map(); let conflicted;
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { const item = JSON.parse(init.body); anchors.set(item.id, item.username); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: ["broken-bot", "healthy-bot"].map(id => ({ id, name: id, ...(anchors.has(id) ? { username: anchors.get(id) } : {}) })) }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const page = { isDestroyed: () => false, session: { fetch: async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "owner-fixture" }) };
    if (url.endsWith("/bot-turns")) return { ok: true, json: async () => ({ jobs: [] }) };
    const input = JSON.parse(init.body);
    if (input.action === "challenge") { conflicted ??= input.bot; return { ok: true, json: async () => ({ nonce }) }; }
    if (input.bot === conflicted) return { ok: false, status: 409 };
    return { ok: true, json: async () => ({ ok: true }) };
  } }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  vi.useFakeTimers();
  personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", (endpoint, init) => localFetch(endpoint, init));
  await vi.advanceTimersByTimeAsync(16_000);
  expect(anchors.has("broken-bot")).toBe(false);
  expect(anchors.get("healthy-bot")).toMatch(/^bot_k[a-f0-9]{64}$/);
});

it("bounds concurrent identity challenges before opening the selection menu", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-identity-bounded-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot")); fixture.menu = null;
  const workspaceId = "33333333-3333-4333-8333-333333333333", nonce = "22222222-2222-4222-8222-222222222222";
  const anchors = new Map(); let active = 0, maximum = 0;
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { const item = JSON.parse(init.body); anchors.set(item.id, item.username); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: Array.from({ length: 10 }, (_, i) => ({ id: `fixture-${i}`, name: `Fixture ${i}`, ...(anchors.has(`fixture-${i}`) ? { username: anchors.get(`fixture-${i}`) } : {}) })) }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const page = { isDestroyed: () => false, session: { fetch: async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "owner-fixture" }) };
    const input = JSON.parse(init.body);
    if (input.action === "challenge") { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; return { ok: true, json: async () => ({ nonce }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  } }, executeJavaScript: async () => {}, once: (_event, cb) => { fixture.destroyed = cb; } };
  const instance = personalInboxBots({ webContents: workspace }, page, "https://fixture.invalid", (endpoint, init) => localFetch(endpoint, init));
  instance.invite("11111111-1111-4111-8111-111111111111");
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(10));
  expect(maximum).toBeLessThanOrEqual(4);
  expect(maximum).toBeGreaterThan(1);
  expect(anchors.size).toBe(10);
});

it("reconnects a legacy bot only after explicit confirmation and keeps its cloud ID across restart", async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "startupbot-legacy-rebind-fixture-"));
  mkdirSync(join(fixture.home, ".startupbot")); fixture.menu = null;
  const file = join(fixture.home, ".startupbot", "personal-inbox-bots.json"), origin = "https://fixture.invalid", owner = "owner-fixture";
  const bot = "11111111-1111-4111-8111-111111111111", room = "22222222-2222-4222-8222-222222222222", sourceWorkspace = "33333333-3333-4333-8333-333333333333", nonce = "44444444-4444-4444-8444-444444444444";
  let workspaceId = "66666666-6666-4666-8666-666666666666";
  const otherRoom = "55555555-5555-4555-8555-555555555555", members = new Map([[room, new Set([bot, "person-fixture-a"])], [otherRoom, new Set([bot, "person-fixture-b"])]]);
  const old = { "fixture-bot": { id: bot, owner, origin } }; writeFileSync(file, JSON.stringify(old));
  let anchored, invited = 0, autoRegistered = 0, anchorFailure = true, changeOwner = true, errors = 0, present = true;
  const claimedNames = [];
  const localFetch = async (endpoint, init) => {
    if (endpoint.endsWith("bot-identity")) {
      if (init?.method === "POST") { anchored = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => ({ workspaceId }) };
    }
    return { ok: true, json: async () => ({ bots: present ? [{ id: "fixture-bot", name: "Fixture", ...(anchored ? { username: anchored.username } : {}) }] : [] }) };
  };
  const workspace = { getURL: () => "http://127.0.0.1:4000", isDestroyed: () => false, executeJavaScript: code => runInNewContext(code, { location: { origin: "http://127.0.0.1:4000" }, fetch: localFetch }) };
  const page = { isDestroyed: () => false, session: { fetch: async (url, init) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: owner }) };
    if (url.endsWith("/bot-identities")) { autoRegistered++; return { ok: false, status: 500 }; }
    const body = JSON.parse(init.body);
    expect(body.bot).toBe(bot);
    if (body.action === "challenge") return { ok: true, json: async () => ({ nonce }) };
    expect(body.action).toBe("invite"); expect(body.username).toMatch(/^bot_k[a-f0-9]{64}$/); claimedNames.push(body.username); members.get(room).add(body.bot); invited++;
    return { ok: true, json: async () => ({ ok: true }) };
  } }, executeJavaScript: async text => { if (text.includes("inbox-bots-error")) errors++; }, once: (_event, cb) => { fixture.destroyed = cb; } };
  const anchor = (endpoint, init) => {
    if (anchorFailure) { anchorFailure = false; return Promise.resolve({ ok: false }); }
    if (changeOwner) { changeOwner = false; writeFileSync(file, JSON.stringify({ "fixture-bot": { ...old["fixture-bot"], owner: "other-owner" } })); }
    return localFetch(endpoint, init);
  };
  const instance = personalInboxBots({ webContents: workspace }, page, origin, anchor);
  instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  present = false; fixture.menu[0].click();
  await vi.waitFor(() => expect(errors).toBe(1));
  expect(invited).toBe(0);
  present = true; fixture.menu = null; instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  fixture.menu[0].click();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(invited).toBe(0); expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(old);
  workspaceId = sourceWorkspace; fixture.menu = null; instance.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  fixture.response = 1; fixture.menu[0].click();
  await vi.waitFor(() => expect(invited).toBe(1));
  await vi.waitFor(() => expect(errors).toBe(2));
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(old);
  fixture.destroyed(); fixture.menu = null;
  const resumed = personalInboxBots({ webContents: workspace }, page, origin, anchor);
  resumed.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  fixture.menu[0].click();
  await vi.waitFor(() => expect(invited).toBe(2));
  await vi.waitFor(() => expect(errors).toBe(3));
  expect(JSON.parse(readFileSync(file, "utf8"))[JSON.stringify([workspaceId, "fixture-bot"])]).toBeUndefined();
  writeFileSync(file, JSON.stringify(old));
  fixture.destroyed(); fixture.menu = null;
  const retry = personalInboxBots({ webContents: workspace }, page, origin, anchor);
  retry.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  fixture.menu[0].click();
  await vi.waitFor(() => expect(invited).toBe(3));
  await vi.waitFor(() => expect(JSON.parse(readFileSync(file, "utf8"))[JSON.stringify([workspaceId, "fixture-bot"])]?.id).toBe(bot));
  expect(claimedNames[0]).toBe(claimedNames[1]);
  expect(claimedNames[1]).toBe(claimedNames[2]);
  expect(JSON.parse(readFileSync(file, "utf8"))["fixture-bot"]).toBeUndefined();
  expect([...members.get(room)]).toEqual([bot, "person-fixture-a"]);
  expect([...members.get(otherRoom)]).toEqual([bot, "person-fixture-b"]);
  expect(autoRegistered).toBe(0);
  fixture.destroyed(); fixture.menu = null;
  const restarted = personalInboxBots({ webContents: workspace }, page, origin, (endpoint, init) => localFetch(endpoint, init));
  restarted.invite(room);
  await vi.waitFor(() => expect(fixture.menu).toHaveLength(1));
  expect(fixture.menu[0].label).toContain(anchored.username);
  expect(JSON.parse(readFileSync(file, "utf8"))[JSON.stringify([workspaceId, "fixture-bot"])].id).toBe(bot);
});
