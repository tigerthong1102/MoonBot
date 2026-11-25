import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, Menu, safeStorage } from "electron";
import { jsonFile } from "./desktop-prefs.mjs";
import { startupBotDataDir } from "./startupbot-identity.mjs";
import { inboxBotLabel } from "./inbox-bot-label.mjs";
import { createPersonalInboxClaims } from "./personal-inbox-claims.mjs";
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
  async function invite(room) {
    if (!uuid.test(room)) return;
    const [me, inventory] = await Promise.all([cloud("me"), local()]);
    const choices = inventory.bots;
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
      const identity = await local(undefined, identityEndpoint);
      const records = bindings(), key = JSON.stringify([identity.workspaceId, bot.id]), existing = records[key];
      const record = existing ?? { id: randomUUID(), owner: me.id, origin, workspaceId: identity.workspaceId, localBotId: bot.id };
      if (record.owner !== me.id || record.origin !== origin)
        throw Error("account_changed");
      if (record.workspaceId && record.workspaceId !== identity?.workspaceId) throw Error("workspace_changed");
      records[key] = record;
      file.write(records);
      const input = { room, bot: record.id, name: bot.name, owner: me.id };
      if (!canEncrypt) {
        if (bot.username) throw Error("identity_storage_unavailable");
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
        label: inboxBotLabel(bot),
        click: () => {
          void pick(bot).catch(() => report("inbox-bots-error"));
        },
      })),
    ).popup({ window });
  }
  let busy = false;
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
  }, 8000);
  page.once("destroyed", () => clearInterval(timer));
  return {
    invite: (room) => {
      void invite(room).catch(() => report("inbox-bots-error"));
    },
  };
}
