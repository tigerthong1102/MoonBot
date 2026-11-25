import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, Menu, safeStorage } from "electron";
import { jsonFile } from "./desktop-prefs.mjs";
import { startupBotDataDir } from "./startupbot-identity.mjs";
import { inboxBotLabel } from "./inbox-bot-label.mjs";
import { createPersonalInboxClaims, identityScope } from "./personal-inbox-claims.mjs";
import { createBotIdentityRegistration } from "./bot-identity-registration.mjs";
import { createBotWorkspaceIdentities } from "./bot-workspace-identities.mjs";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function personalInboxBots(window, page, origin, localRequest) {
  const workspace = window.webContents;
  const localOrigin = new URL(workspace.getURL()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(localOrigin)) return null;
  const data = startupBotDataDir(app.getPath("home"), process.env.OMB_DATA_DIR);
  const file = jsonFile(path.join(data, "personal-inbox-bots.json"));
  function bindings() {
    try {
      return file.read();
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw e;
    }
  }
  function current() {
    return (
      !page.isDestroyed() &&
      !workspace.isDestroyed() &&
      new URL(workspace.getURL()).origin === localOrigin
    );
  }
  async function local(input, endpoint = "/api/personal-inbox/bots") {
    if (!current()) throw Error("workspace_closed");
    const init = input
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      : {};
    return workspace.executeJavaScript(
      `(async()=>{if(location.origin!==${JSON.stringify(localOrigin)}) throw Error("workspace_closed");const r=await fetch(${JSON.stringify(endpoint)},${JSON.stringify(init)});if(!r.ok)throw Error("unavailable");return r.json()})()`,
    );
  }
  async function cloud(endpoint, input) {
    if (!current()) throw Error("workspace_closed");
    const response = await page.session.fetch(origin + "/api/" + endpoint, {
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      ...(input
        ? {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }
        : {}),
    });
    if (!response.ok) throw Object.assign(Error("unavailable"), { status: response.status });
    return response.json();
  }
  const claims = createPersonalInboxClaims(cloud);
  const picksInFlight = new Set();
  const preparations = new Map();
  const preparationRetryAt = new Map();
  let identityRegistrationUnavailable = false;
  const identityEndpoint = "/api/personal-inbox/bot-identity";
  const encryption = { available: async () => (await safeStorage.isAsyncEncryptionAvailable()) && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"), encrypt: value => safeStorage.encryptStringAsync(value), decrypt: value => safeStorage.decryptStringAsync(value) };
  function report(type) {
    if (current())
      void page
        .executeJavaScript(
          "window.dispatchEvent(new Event(" + JSON.stringify(type) + "))",
        )
        .catch(() => {});
  }
  async function prepareIdentity(bot, owner, workspaceId) {
    const key = JSON.stringify([workspaceId, bot.id]);
    if (preparations.has(key)) return preparations.get(key);
    const pending = (async () => {
      if (!(await encryption.available())) throw Error("identity_storage_unavailable");
      const records = bindings(), record = records[key] ?? { id: randomUUID(), owner, origin, workspaceId, localBotId: bot.id };
      if (record.owner !== owner || record.origin !== origin || record.workspaceId !== workspaceId) throw Error("account_changed");
      records[key] = record; file.write(records);
      const identities = createBotWorkspaceIdentities({ workspaceId, publicDirectory: path.join(app.getPath("userData"), "bot-public-identities"), privateDirectory: path.join(app.getPath("userData"), "bot-private-identities"), encryption, current: scope => current() && scope.workspaceId === workspaceId });
      let signed;
      const registration = createBotIdentityRegistration({ ...identities,
        loadIdentity: async scope => {
          const [saved, inventory] = await Promise.all([identities.loadIdentity(scope), local()]);
          const anchored = inventory.bots.find(item => item.id === scope.localBotId)?.username;
          if (anchored && (saved.kind !== "existing" || saved.username !== anchored)) throw Error("identity_changed");
          return saved;
        },
        currentAccount: async () => (await cloud("me")).id,
        validateTarget: async scope => {
          const [identity, inventory] = await Promise.all([local(undefined, identityEndpoint), local()]);
          return identity.workspaceId === scope.workspaceId && inventory.bots.some(item => item.id === scope.localBotId);
        },
        challenge: async request => {
          try { const result = await claims.identityChallenge(request); identityRegistrationUnavailable = false; return result; }
          catch (error) { if (error?.status === 404 || error?.status === 405) identityRegistrationUnavailable = true; throw error; }
        },
        invite: async request => { await claims.registerIdentity(request); signed = request; },
      });
      await registration.register({ workspaceId, localBotId: bot.id, bindingId: record.id, owner, room: identityScope, origin, name: bot.name });
      if (!signed || (await cloud("me")).id !== owner) throw Error("account_changed");
      if (!current() || typeof localRequest !== "function") throw Error("workspace_closed");
      const response = await localRequest(identityEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: bot.id, workspaceId, username: signed.username, publicKey: signed.proof.publicKey }) });
      if (!response.ok) throw Error("identity_unavailable");
      return signed.username;
    })().finally(() => { if (preparations.get(key) === pending) preparations.delete(key); });
    preparations.set(key, pending);
    return pending;
  }
  async function prepareInventory(bots, owner, workspaceId) {
    let cursor = 0;
    const pending = bots.filter(bot => !bot.username);
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (cursor < pending.length) {
        const bot = pending[cursor++];
        try { await prepareIdentity(bot, owner, workspaceId); preparationRetryAt.delete(JSON.stringify([workspaceId, bot.id])); }
        catch { preparationRetryAt.set(JSON.stringify([workspaceId, bot.id]), Date.now() + 30_000); }
      }
    }));
  }
  async function invite(room) {
    if (!uuid.test(room)) return;
    const [me, inventory, identity] = await Promise.all([cloud("me"), local(), local(undefined, identityEndpoint)]);
    const registrations = prepareInventory(inventory.bots, me.id, identity.workspaceId);
    await Promise.race([registrations, new Promise(resolve => setTimeout(resolve, 1500))]);
    const [currentIdentity, account, currentInventory] = await Promise.all([local(undefined, identityEndpoint), cloud("me"), local()]);
    if (currentIdentity.workspaceId !== identity.workspaceId || account.id !== me.id) throw Error("workspace_changed");
    const choices = currentInventory.bots;
    const canSignFallback = identityRegistrationUnavailable && await encryption.available().catch(() => false);
    if (!choices.length) {
      report("inbox-bots-empty");
      return;
    }
    async function pick(bot) {
      if (picksInFlight.has(bot.id)) return;
      picksInFlight.add(bot.id);
      try {
      if ((await cloud("me")).id !== me.id) throw Error("account_changed");
      const canEncrypt = await encryption.available().catch(() => false);
      const selectedIdentity = await local(undefined, identityEndpoint);
      const selected = (await local()).bots.find(item => item.id === bot.id);
      if (selectedIdentity.workspaceId !== identity.workspaceId || (!bot.username && !canSignFallback) || selected?.username !== bot.username) throw Error("workspace_changed");
      const records = bindings(), key = JSON.stringify([identity.workspaceId, bot.id]), existing = records[key];
      const record = existing ?? { id: randomUUID(), owner: me.id, origin, workspaceId: identity.workspaceId, localBotId: bot.id };
      if (record.owner !== me.id || record.origin !== origin)
        throw Error("account_changed");
      if (record.workspaceId && record.workspaceId !== identity.workspaceId) throw Error("workspace_changed");
      records[key] = record;
      file.write(records);
      const input = { room, bot: record.id, name: bot.name, owner: me.id };
      if (!canEncrypt) {
        if (bot.username || canSignFallback) throw Error("identity_storage_unavailable");
        if ((await cloud("me")).id !== me.id || (await local(undefined, identityEndpoint)).workspaceId !== identity.workspaceId || !(await local()).bots.some(item => item.id === bot.id)) throw Error("workspace_changed");
        await claims.inviteLegacy(input);
      } else {
        const { workspaceId } = identity;
        const identities = createBotWorkspaceIdentities({ workspaceId, publicDirectory: path.join(app.getPath("userData"), "bot-public-identities"), privateDirectory: path.join(app.getPath("userData"), "bot-private-identities"), encryption, current: scope => current() && scope.workspaceId === workspaceId });
        let signed;
        const registration = createBotIdentityRegistration({ ...identities,
          loadIdentity: async scope => {
            const [saved, inventory] = await Promise.all([identities.loadIdentity(scope), local()]);
            const anchored = inventory.bots.find(item => item.id === scope.localBotId)?.username;
            if (anchored && (saved.kind !== "existing" || saved.username !== anchored)) throw Error("identity_changed");
            return saved;
          },
          currentAccount: async () => (await cloud("me")).id,
          validateTarget: async scope => {
            const [identity, inventory] = await Promise.all([local(undefined, identityEndpoint), local()]);
            return identity.workspaceId === scope.workspaceId && inventory.bots.some(item => item.id === scope.localBotId);
          },
          challenge: async request => {
            try { return await claims.challenge(request); }
            catch (error) { if (error?.status === 400) throw Object.assign(Error("legacy_service"), { cause: error }); throw error; }
          },
          invite: async request => { await claims.invite(request); signed = request; },
        });
        try { await registration.register({ workspaceId, localBotId: bot.id, bindingId: record.id, owner: me.id, room, origin, name: bot.name }); }
        catch (error) {
          if (error?.message !== "legacy_service" || bot.username) throw error;
          if ((await cloud("me")).id !== me.id || (await local(undefined, identityEndpoint)).workspaceId !== workspaceId || !(await local()).bots.some(item => item.id === bot.id)) throw Error("workspace_changed");
          await claims.inviteLegacy(input);
        }
        if (signed) {
          if ((await cloud("me")).id !== me.id) throw Error("account_changed");
          if (!current() || typeof localRequest !== "function") throw Error("workspace_closed");
          const response = await localRequest(identityEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: bot.id, workspaceId, username: signed.username, publicKey: signed.proof.publicKey }) });
          if (!response.ok) throw Error("identity_unavailable");
        }
      }
      report("inbox-bots-changed");
      } finally { picksInFlight.delete(bot.id); }
    }
    Menu.buildFromTemplate(
      choices.map((bot) => ({
        label: bot.username ? inboxBotLabel(bot) : canSignFallback ? `${bot.name} (ID: ${bot.id})` : `${bot.name} (…)`,
        enabled: Boolean(bot.username) || canSignFallback,
        click: () => {
          void pick(bot).catch(() => report("inbox-bots-error"));
        },
      })),
    ).popup({ window });
  }
  let busy = false;
  let preparing = false, nextPreparation = 0, preparationCursor = 0;
  async function retryPreparation() {
    if (preparing || !current() || Date.now() < nextPreparation) return;
    preparing = true;
    try {
      const inventory = await local();
      const pending = inventory.bots.filter(item => !item.username);
      if (!pending.length) { nextPreparation = Date.now() + 60_000; return; }
      const [me, identity] = await Promise.all([cloud("me"), local(undefined, identityEndpoint)]);
      const index = pending.findIndex((item, offset) => offset >= preparationCursor % pending.length && Date.now() >= (preparationRetryAt.get(JSON.stringify([identity.workspaceId, item.id])) ?? 0));
      const fallback = pending.findIndex(item => Date.now() >= (preparationRetryAt.get(JSON.stringify([identity.workspaceId, item.id])) ?? 0));
      const chosen = index >= 0 ? index : fallback;
      if (chosen < 0) { nextPreparation = Date.now() + 8_000; return; }
      const bot = pending[chosen]; preparationCursor = (chosen + 1) % pending.length;
      try { await prepareIdentity(bot, me.id, identity.workspaceId); preparationRetryAt.delete(JSON.stringify([identity.workspaceId, bot.id])); }
      catch { preparationRetryAt.set(JSON.stringify([identity.workspaceId, bot.id]), Date.now() + 30_000); }
      nextPreparation = Date.now() + 5_000;
    } catch { nextPreparation = Date.now() + 30_000; }
    finally { preparing = false; }
  }
  async function poll() {
    if (busy || !current()) return;
    busy = true;
    try {
      const stored = Object.entries(bindings());
      let workspaceId;
      if (stored.length) {
        try { workspaceId = (await local(undefined, identityEndpoint)).workspaceId; } catch {}
      }
      const records = stored.filter(
        ([, b]) => b.origin === origin && Boolean(b.workspaceId) && b.workspaceId === workspaceId,
      ).map(([key, b]) => [b.localBotId ?? key, b]);
      if (!records.length) return;
      const { jobs } = await cloud("bot-turns");
      for (const { bot, room } of jobs) {
        const entry = records.find(([, b]) => b.id === bot);
        if (!entry || !uuid.test(room)) continue;
        const { job } = await cloud("rooms/" + room + "/bots", {
          action: "claim",
          bot,
        });
        if (!job) continue;
        let text = null;
        try {
          if (entry[1].workspaceId && (await local(undefined, identityEndpoint)).workspaceId !== entry[1].workspaceId) throw Error("workspace_changed");
          const reply = await local({
            id: entry[0],
            ...(entry[1].workspaceId ? { workspaceId: entry[1].workspaceId } : {}),
            topic: job.topic,
            prior: job.prior,
            locale: job.locale,
          });
          text = reply.text || null;
        } finally {
          await cloud("rooms/" + room + "/bots", {
            action: "reply",
            bot,
            round: job.id,
            claim: job.claim,
            text,
          });
        }
      }
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => {
    void poll().catch(() => {});
    void retryPreparation();
  }, 8000);
  page.once("destroyed", () => clearInterval(timer));
  return {
    invite: (room) => {
      void invite(room).catch(() => report("inbox-bots-error"));
    },
  };
}
