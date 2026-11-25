import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { app, dialog, Menu, safeStorage } from "electron";
import { jsonFile } from "./desktop-prefs.mjs";
import { startupBotDataDir } from "./startupbot-identity.mjs";
import { inboxBotLabel } from "./inbox-bot-label.mjs";
import { createPersonalInboxClaims, identityScope } from "./personal-inbox-claims.mjs";
import { createBotIdentityRegistration } from "./bot-identity-registration.mjs";
import { createBotWorkspaceIdentities } from "./bot-workspace-identities.mjs";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const preparations = new Map();

export function personalInboxBots(window, page, origin, localRequest, language = "en", { identityOnly = false } = {}) {
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
  function assertNoOtherPending(records, workspaceId, bot, owner) {
    if (!bot.username && Object.values(records).some(record => record?.workspaceId === workspaceId && record.localBotId === bot.id && (record.owner !== owner || record.origin !== origin) && record.registrationState !== "fresh" && record.definitiveRejected !== true)) throw Error("identity_pending_other_account");
  }
  function bindingKey(records, workspaceId, bot, owner) {
    const primary = JSON.stringify([workspaceId, bot.id]);
    const alternate = JSON.stringify([workspaceId, bot.id, origin, owner]);
    assertNoOtherPending(records, workspaceId, bot, owner);
    if (records[alternate]) return alternate;
    const record = records[primary];
    return record && (record.owner !== owner || record.origin !== origin) && (record.registrationState === "fresh" || record.definitiveRejected === true) && !bot.username ? alternate : primary;
  }
  function identityNamespace(record) {
    return record.accountScoped ? `account:${createHash("sha256").update(JSON.stringify([record.workspaceId, record.origin, record.owner])).digest("hex")}` : record.workspaceId;
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
    if (!response.ok) {
      let code;
      if (response.status === 409) { try { code = (await response.json()).error; } catch {} }
      throw Object.assign(Error("unavailable"), { status: response.status, code });
    }
    return response.json();
  }
  const claims = createPersonalInboxClaims(cloud);
  const picksInFlight = new Set();
  const preparationRetryAt = new Map();
  const identityEndpoint = "/api/personal-inbox/bot-identity";
  let encryptionProbe;
  const encryption = { available: async () => {
    encryptionProbe ??= Promise.resolve().then(() => safeStorage.isAsyncEncryptionAvailable()).then(available => available && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")).catch(() => false).finally(() => { encryptionProbe = undefined; });
    let timer;
    try { return await Promise.race([encryptionProbe, new Promise(resolve => { timer = setTimeout(() => resolve(false), 2_000); })]); }
    finally { clearTimeout(timer); }
  }, encrypt: value => safeStorage.encryptStringAsync(value), decrypt: value => safeStorage.decryptStringAsync(value) };
  function report(type) {
    if (current())
      void page
        .executeJavaScript(
          "window.dispatchEvent(new Event(" + JSON.stringify(type) + "))",
        )
        .catch(() => {});
  }
  async function prepareIdentity(bot, owner, workspaceId) {
    const key = JSON.stringify([origin, workspaceId, bot.id]);
    if (preparations.has(key)) return preparations.get(key);
    const pending = (async () => {
      if (!(await encryption.available())) throw Error("identity_storage_unavailable");
      const records = bindings(), key = bindingKey(records, workspaceId, bot, owner);
      const record = records[key] ?? { id: randomUUID(), owner, origin, workspaceId, localBotId: bot.id, accountScoped: true, registrationState: "fresh" };
      if (record.owner !== owner || record.origin !== origin || record.workspaceId !== workspaceId) throw Error("account_changed");
      records[key] = record; file.write(records);
      const identities = createBotWorkspaceIdentities({ workspaceId, namespace: identityNamespace(record), publicDirectory: path.join(app.getPath("userData"), "bot-public-identities"), privateDirectory: path.join(app.getPath("userData"), "bot-private-identities"), encryption, current: scope => current() && scope.workspaceId === workspaceId });
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
        challenge: claims.identityChallenge,
        invite: async request => {
          const before = bindings(), candidate = before[key];
          assertNoOtherPending(before, workspaceId, bot, owner);
          if (candidate?.id !== record.id || candidate.owner !== owner || candidate.origin !== origin || candidate.workspaceId !== workspaceId) throw Error("identity_changed");
          const canMarkRejected = candidate?.id === record.id && candidate.accountScoped === true && ["fresh", "rejected"].includes(candidate.registrationState);
          const pendingClaim = randomUUID();
          before[key] = { ...candidate, definitiveRejected: false, registrationState: "pending", pendingClaim }; file.write(before);
          try { await claims.registerIdentity(request); signed = request; }
          catch (error) {
            if (canMarkRejected && error?.status === 403) {
              const fresh = bindings(), saved = fresh[key];
              if (saved?.id === record.id && saved.owner === owner && saved.origin === origin && saved.workspaceId === workspaceId && saved.pendingClaim === pendingClaim) {
                fresh[key] = { ...saved, definitiveRejected: true, registrationState: "rejected" }; file.write(fresh);
              }
            }
            throw error;
          }
        },
      });
      await registration.register({ workspaceId, localBotId: bot.id, bindingId: record.id, owner, room: identityScope, origin, name: "Bot" });
      if (!signed || (await cloud("me")).id !== owner) throw Error("account_changed");
      if (!current() || typeof localRequest !== "function") throw Error("workspace_closed");
      const response = await localRequest(identityEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: bot.id, workspaceId, username: signed.username, publicKey: signed.proof.publicKey }) });
      if (!response.ok) throw Error("identity_unavailable");
      return signed.username;
    })().finally(() => { if (preparations.get(key) === pending) preparations.delete(key); });
    preparations.set(key, pending);
    return pending;
  }
  async function prepareInventory(bots, owner, workspaceId, unsupported) {
    let cursor = 0;
    const legacy = bindings();
    const pending = bots.filter(bot => !bot.username && !(legacy[bot.id] && !legacy[bot.id].workspaceId));
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (cursor < pending.length) {
        const bot = pending[cursor++];
        try { await prepareIdentity(bot, owner, workspaceId); preparationRetryAt.delete(JSON.stringify([workspaceId, bot.id])); }
        catch (error) { if (error?.status === 404 || error?.status === 405 || error?.code === "identity_capacity") unsupported.add(bot.id); preparationRetryAt.set(JSON.stringify([workspaceId, bot.id]), Date.now() + 30_000); }
      }
    }));
  }
  async function invite(room) {
    if (!uuid.test(room)) return;
    const [me, inventory, identity] = await Promise.all([cloud("me"), local(), local(undefined, identityEndpoint)]);
    const unsupported = new Set();
    const registrations = prepareInventory(inventory.bots, me.id, identity.workspaceId, unsupported);
    await Promise.race([registrations, new Promise(resolve => setTimeout(resolve, 1500))]);
    const [currentIdentity, account, currentInventory] = await Promise.all([local(undefined, identityEndpoint), cloud("me"), local()]);
    if (currentIdentity.workspaceId !== identity.workspaceId || account.id !== me.id) throw Error("workspace_changed");
    const choices = currentInventory.bots;
    const canEncrypt = await encryption.available().catch(() => false);
    const fallbackIds = new Set(unsupported);
    const canSignFallback = bot => canEncrypt && fallbackIds.has(bot.id);
    const legacy = bindings();
    const legacyFor = bot => {
      const record = legacy[bot.id];
      return record && !record.workspaceId && record.owner === me.id && record.origin === origin ? record : null;
    };
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
      const oldBinding = legacyFor(bot);
      if (selectedIdentity.workspaceId !== identity.workspaceId || !selected || (!bot.username && !canSignFallback(bot) && !oldBinding) || selected.username !== bot.username) throw Error("workspace_changed");
      if (oldBinding) {
        if (!canEncrypt) throw Error("identity_storage_unavailable");
        const vi = /^vi(?:-|$)/i.test(language);
        const answer = await dialog.showMessageBox(window, { type: "question", buttons: vi ? ["Hủy", "Kết nối bot cũ"] : ["Cancel", "Connect existing bot"], defaultId: 0, cancelId: 0,
          message: vi ? `Kết nối ${bot.name} với workspace này?` : `Connect ${bot.name} to this workspace?`,
          detail: vi ? `Workspace: ${identity.workspaceId}\nBot: ${bot.id}\n\nBot cũ sẽ được kết nối lại trong mọi nhóm mà bot đã tham gia. Chỉ tiếp tục nếu các nhóm đó thuộc workspace này. Thành viên nhóm có thể giao việc cho bot.` : `Workspace: ${identity.workspaceId}\nBot: ${bot.id}\n\nThis reconnects the existing bot in every group where it is already a member. Only continue if those groups belong to this workspace. Existing group members may send work to this bot.` });
        if (answer.response !== 1) return;
        if ((await cloud("me")).id !== me.id || (await local(undefined, identityEndpoint)).workspaceId !== identity.workspaceId) throw Error("workspace_changed");
      }
      const records = bindings(), key = bindingKey(records, identity.workspaceId, bot, me.id), existing = records[key];
      if (oldBinding && (existing || records[bot.id]?.id !== oldBinding.id || records[bot.id]?.owner !== oldBinding.owner || records[bot.id]?.origin !== oldBinding.origin || records[bot.id]?.workspaceId)) throw Error("identity_changed");
      const record = existing ?? (oldBinding ? { ...oldBinding, workspaceId: identity.workspaceId, localBotId: bot.id } : { id: randomUUID(), owner: me.id, origin, workspaceId: identity.workspaceId, localBotId: bot.id, accountScoped: true });
      if (record.owner !== me.id || record.origin !== origin)
        throw Error("account_changed");
      if (record.workspaceId && record.workspaceId !== identity.workspaceId) throw Error("workspace_changed");
      if (!oldBinding) { records[key] = record; file.write(records); }
      const input = { room, bot: record.id, name: bot.name, owner: me.id };
      if (!canEncrypt) {
        if (bot.username || canSignFallback(bot)) throw Error("identity_storage_unavailable");
        if ((await cloud("me")).id !== me.id || (await local(undefined, identityEndpoint)).workspaceId !== identity.workspaceId || !(await local()).bots.some(item => item.id === bot.id)) throw Error("workspace_changed");
        await claims.inviteLegacy(input);
      } else {
        const { workspaceId } = identity;
        const identities = createBotWorkspaceIdentities({ workspaceId, namespace: identityNamespace(record), publicDirectory: path.join(app.getPath("userData"), "bot-public-identities"), privateDirectory: path.join(app.getPath("userData"), "bot-private-identities"), encryption, current: scope => current() && scope.workspaceId === workspaceId });
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
          invite: async request => {
            let canMarkRejected = false;
            const pendingClaim = randomUUID();
            if (!oldBinding) {
              const fresh = bindings(), saved = fresh[key];
              assertNoOtherPending(fresh, workspaceId, bot, me.id);
              if (saved?.id !== record.id || saved.owner !== me.id || saved.origin !== origin || saved.workspaceId !== workspaceId) throw Error("identity_changed");
              canMarkRejected = saved.accountScoped === true && ["fresh", "rejected"].includes(saved.registrationState);
              fresh[key] = { ...saved, definitiveRejected: false, registrationState: "pending", pendingClaim }; file.write(fresh);
            }
            try { await claims.invite(request); signed = request; }
            catch (error) {
              if (canMarkRejected && error?.status === 403) {
                const fresh = bindings(), saved = fresh[key];
                if (saved?.id === record.id && saved.owner === me.id && saved.origin === origin && saved.workspaceId === workspaceId && saved.registrationState === "pending" && saved.pendingClaim === pendingClaim) {
                  fresh[key] = { ...saved, definitiveRejected: true, registrationState: "rejected" }; file.write(fresh);
                }
              }
              throw error;
            }
          },
        });
        try { await registration.register({ workspaceId, localBotId: bot.id, bindingId: record.id, owner: me.id, room, origin, name: bot.name }); }
        catch (error) {
          if (error?.message !== "legacy_service" || bot.username || oldBinding || canSignFallback(bot)) throw error;
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
      if (oldBinding) {
        if (!current() || (await cloud("me")).id !== me.id || (await local(undefined, identityEndpoint)).workspaceId !== identity.workspaceId) throw Error("workspace_changed");
        const fresh = bindings();
        if (fresh[key] || fresh[bot.id]?.id !== oldBinding.id || fresh[bot.id]?.owner !== oldBinding.owner || fresh[bot.id]?.origin !== oldBinding.origin || fresh[bot.id]?.workspaceId) throw Error("identity_changed");
        delete fresh[bot.id]; fresh[key] = record; file.write(fresh);
      }
      report("inbox-bots-changed");
      } finally { picksInFlight.delete(bot.id); }
    }
    Menu.buildFromTemplate(
      choices.map((bot) => ({
        label: bot.username ? inboxBotLabel(bot) : canSignFallback(bot) || legacyFor(bot) ? `${bot.name} (ID: ${bot.id})` : `${bot.name} (…)`,
        enabled: Boolean(bot.username) || canSignFallback(bot) || Boolean(legacyFor(bot) && canEncrypt),
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
      if (identityOnly && !(await page.session.cookies.get({ url: origin })).length) { nextPreparation = Date.now() + 60_000; return; }
      const [me, identity] = await Promise.all([cloud("me"), local(undefined, identityEndpoint)]);
      const legacy = bindings();
      for (let i = pending.length - 1; i >= 0; i--) if (legacy[pending[i].id] && !legacy[pending[i].id].workspaceId) pending.splice(i, 1);
      if (!pending.length) { nextPreparation = Date.now() + 60_000; return; }
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
    if (!identityOnly) void poll().catch(() => {});
    void retryPreparation();
  }, 8000);
  page.once("destroyed", () => clearInterval(timer));
  return {
    invite: (room) => {
      void invite(room).catch(() => report("inbox-bots-error"));
    },
  };
}
