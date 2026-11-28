import { generatedStatus, recoverGenerated } from "./twin-online-generated.mjs";
import { readExactStatus,recoverExact } from "./twin-online-exact.mjs";
import { exactReplyJournal } from "./twin-exact-journal.mjs";
import { createTwinInboxPairing } from "./twin-inbox-pairing.mjs";
import { personalAccountUpdates } from "./personal-account-updates.mjs";
import { watchInboxIdentities } from "./personal-inbox-identity-watch.mjs";
import { cleanEmail } from "./cloud-signin.mjs";
import { personalInboxBots } from "./personal-inbox-bots.mjs";
import path from "node:path";
import { createRequire } from "node:module";
import { configuredInboxOrigin } from "./startupbot-identity.mjs";
import { jsonFile } from "./desktop-prefs.mjs";
import { app, dialog, session, systemPreferences, WebContentsView } from "electron";
import { fileURLToPath } from "node:url";
import { installInboxVoice, registerInboxVoice } from "./personal-inbox-voice.mjs";
import { speechBusy } from "./speech.mjs";
import { askForMicrophone } from "./privacy-settings.mjs";

const panels = new WeakMap();
const skins = new WeakMap();
const partition = "persist:startupbot-personal-inbox";
const requestMicrophone = () => process.platform !== "darwin" || askForMicrophone({ available: true, systemPreferences });

async function waitForWorkspace(win) {
  const page = win.webContents;
  if (page.getURL() && !page.isLoadingMainFrame()) return;
  await new Promise((resolve, reject) => {
    const done = () => finish(resolve);
    const stopped = () => finish(() => reject(Error("StartupBot workspace is unavailable")));
    const timer = setTimeout(stopped, 20000);
    function finish(callback) {
      clearTimeout(timer);
      page.off("did-stop-loading", done);
      win.off("closed", stopped);
      callback();
    }
    page.once("did-stop-loading", done);
    win.once("closed", stopped);
  });
}

export async function personalAccountEmail(origin) {
  if (!origin) throw new Error("StartupBot account service is unavailable");
  const account = session.fromPartition(partition);
  if (!(await account.cookies.get({ url: origin })).length) return null;
  const response = await account.fetch(origin + "/api/me", {
    credentials: "include", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("StartupBot account service is unavailable");
  const { email } = await response.json();
  if (typeof email !== "string" || !email) throw new Error("Invalid StartupBot account");
  return email;
}

export async function signOutPersonalAccount(origin) {
  if (!origin) throw new Error("StartupBot account service is unavailable");
  const response = await session.fromPartition(partition).fetch(origin + "/api/auth/sign-out", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
    credentials: "include", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("StartupBot sign-out failed");
}

export async function showPersonalInbox(window, origin, language, requestSignIn, { localWorkspace, room, localRequest }) {
  if (!window || window.isDestroyed() || !origin) return;
  const existing = panels.get(window)?.view;
  if (existing) {
    if (room) await existing.webContents.executeJavaScript(
      "if (location.origin === " + JSON.stringify(origin) + ") location.hash = " + JSON.stringify("room=" + room),
    );
    existing.webContents.focus();
    return;
  }
  const view = new WebContentsView({ webPreferences: {
    partition, preload: fileURLToPath(new URL("./personal-inbox-preload.cjs", import.meta.url)),
    additionalArguments: ["--startupbot-inbox-origin=" + origin],
    nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false,
  } });
  const page = view.webContents;
  const workspace = window.webContents;
  const bots = personalInboxBots(window, page, origin, localRequest, language);
  const disposeVoice = registerInboxVoice({ page, workspace, origin, localWorkspace, requestMicrophone, canStartDictation: () => !speechBusy() });
  const invitePath = origin + "/desktop/invite-bot/";
  page.setWindowOpenHandler(({ url }) => {
    if (bots && url.startsWith(invitePath)) bots.invite(url.slice(invitePath.length));
    return { action: "deny" };
  });
  const fit = () => {
    if (localWorkspace()) return;
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: 40, width, height: Math.max(1, height - 40) });
  };
  const close = () => {
    if (panels.get(window)?.view !== view) return;
    panels.delete(window);
    disposeVoice.close();
    window.off("resize", fit);
    window.off("closed", close);
    workspace.off("did-navigate", close);
    if (!window.isDestroyed()) {
      window.contentView.removeChildView(view);
      workspace.focus();
      workspace.send("personal-inbox:visibility", false);
      workspace.send("personal-account:changed");
    }
    if (!page.isDestroyed()) page.close();
  };
  const navigate = (event, target) => {
    if (bots && target.startsWith(invitePath)) {
      event.preventDefault();
      bots.invite(target.slice(invitePath.length));
    } else if (target === origin + "/desktop/sign-in") {
      event.preventDefault();
      close();
      void requestSignIn().catch(() => {});
    } else if (target === origin + "/desktop/back") {
      event.preventDefault();
      close();
    } else if (!URL.canParse(target) || new URL(target).origin !== origin) {
      event.preventDefault();
    }
  };
  page.on("will-navigate", navigate);
  page.on("will-redirect", navigate);
  page.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "ArrowLeft" && input.alt) {
      event.preventDefault();
      close();
    }
  });
  page.once("render-process-gone", close);
  page.on("did-navigate", disposeVoice.reset);
  panels.set(window, { view, close });
  view.setVisible(!localWorkspace());
  window.contentView.addChildView(view);
  window.on("resize", fit);
  window.once("closed", close);
  workspace.once("did-navigate", close);
  fit();
  if (localWorkspace()) workspace.send("personal-inbox:visibility", true);
  try {
    const params = new URLSearchParams({ desktop: "1", hostAuth: "1", lang: language });
    if (skins.has(window)) params.set("skin", skins.get(window));
    if (bots) params.set("bots", "1");
    await page.loadURL(origin + "/?" + params + (room ? "#room=" + room : ""));
    if (!page.isDestroyed()) page.focus();
  } catch (error) {
    if (panels.get(window)?.view !== view) return;
    close();
    throw error;
  }
}

export function createPersonalInbox({ window, locale, languageKey, isLocal, showLocal, previousChoice, localRequest, localRuntime, translate }) {
  const metadata = createRequire(import.meta.url)("../package.json");
  function origin() {
    return configuredInboxOrigin(process.env.STARTUPBOT_INBOX_ORIGIN, metadata.startupbotInboxOrigin,
      jsonFile(path.join(app.getPath("userData"), "inbox-service.json")).read);
  }
  function watchIdentities(win) {
    watchInboxIdentities({ win, origin, isLocal, inboxSession: () => session.fromPartition(partition), localRequest, locale, startBots: personalInboxBots });
  }
  async function requestSignIn(win, inbox) {
    await waitForWorkspace(win);
    if (!isLocal(win)) {
      await showLocal();
      if (win.isDestroyed()) return;
      await waitForWorkspace(win);
    }
    if (!isLocal(win)) throw Error("Open StartupBot on this computer.");
    win.webContents.send("personal-account:prompt", inbox);
  }
  async function open(accountOnly = false, room) {
    const win = window();
    win.show();
    if (accountOnly) return requestSignIn(win, false);
    const existing = panels.get(win)?.view;
    if (existing && !room) { existing.webContents.focus(); return; }
    const base = origin();
    const email = await personalAccountEmail(base);
    if (win.isDestroyed()) return;
    if (!email) return requestSignIn(win, true);
    await waitForWorkspace(win);
    return showPersonalInbox(win, base, locale(), () => requestSignIn(win, true), {
      localWorkspace: () => !win.isDestroyed() && isLocal(win), room, localRequest,
    });
  }
  function install(ipcMain, localOnly, requireMainWindowSender) {
    installInboxVoice(ipcMain, localOnly, requireMainWindowSender);
    function handle(channel, action) {
      ipcMain.handle(channel, localOnly(channel, (event, ...args) => {
        requireMainWindowSender(event);
        return action(event, ...args);
      }));
    }
    let pairing, disposePairing;
    const exactJournal = exactReplyJournal(path.join(app.getPath("userData"), "pending-exact-replies"));
    const generatedJournal = exactReplyJournal(path.join(app.getPath("userData"), "pending-generated-replies"));
    function accountRequest(base, current) {
      const account = session.fromPartition(partition);
      return async (route, data) => {
        if (!current()) throw Error("pairing_unavailable");
        const response = await account.fetch(base + "/api/" + route, {
          credentials: "include",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          ...(data && {
            method: "POST",
            headers: { Origin: base, "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }),
        }).catch(() => {
          if (!current()) throw Error("pairing_unavailable");
          throw Object.assign(Error("Inbox temporarily unavailable"), { code: "INBOX_NETWORK_UNAVAILABLE" });
        });
        if (!current()) throw Error("pairing_unavailable");
        if (response.status >= 500) throw Object.assign(Error("Inbox temporarily unavailable"), { code: "INBOX_NETWORK_UNAVAILABLE" });
        if (!response.ok) throw Error("pairing_unavailable");
        return response.json();
      };
    }
    function standalone(journal = exactJournal) {
      const win = window(),
        base = origin();
      if (!base || new URL(base).protocol !== "https:" || !isLocal(win)) throw Error("exact_reply_unavailable");
      return {
        origin: base,
        journal,
        inbox: accountRequest(base, () => !win.isDestroyed() && isLocal(win) && origin() === base),
      };
    }
    async function exactStatus() {
      if (pairing) return pairing.exact.status();
      const context = standalone(),
        me = await recoverExact(context);
      return readExactStatus(context.inbox, me);
    }
    handle("personal-inbox:twin-pair-start", async () => {
      disposePairing?.();
      const win = window(),
        base = origin(),
        runtime = localRuntime?.();
      if (!runtime || !base || new URL(base).protocol !== "https:" || !isLocal(win))
        throw Error("pairing_unavailable");
      const current = () => !win.isDestroyed() && isLocal(win) && origin() === base && localRuntime() === runtime;
      const localView = async (route) => {
        const response = await localRequest(route, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Error("pairing_unavailable");
        return response.json();
      };
      const instance = createTwinInboxPairing({
        exactJournal, generatedJournal,
        generatedProfile: () => localView("/api/ai-twin/inbox-generated"),
        generate: async (body, signal) => {
          if (!current()) throw Error("generated_reply_unavailable");
          const res = await localRequest("/api/ai-twin/inbox-generated", { method: "POST", cache: "no-store", signal,
            headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          if (!res.ok || !current()) throw Error("generated_reply_unavailable");
          return res.json();
        },
        approveGenerated: async ({ grant, chosen, kinds }) => {
          const p = grant.provider;
          const consent = await dialog.showMessageBox(win, {
            type: "question", message: translate("personalInbox.generatedTitle"),
            detail: [translate("personalInbox.generatedTerms"), p.name, p.model, p.destination,
              grant.origin, grant.owner, ...kinds.map(kind => translate(kind === "direct" ? "personalInbox.generatedAllDirect" : "personalInbox.generatedAllGroups")), ...chosen.map(r => r.title + " (" + r.id + ")"), ...(grant.dailyLimit !== undefined ? [translate("personalInbox.generatedOngoingTerms", {count: grant.dailyLimit})] : []), new Date(grant.expires).toLocaleString()].join("\n\n"),
            buttons: [translate("native.common.cancel"), translate("personalInbox.generatedOffer")], defaultId: 0, cancelId: 0,
          });
          return consent.response === 1;
        },
        approveExact: async ({ grant, all, chosen }) => {
          const roomNames = all
            ? translate("personalInbox.exactAll")
            : chosen
                .map(
                  (r) =>
                    r.title +
                    " (" +
                    translate(r.kind === "group" ? "personalInbox.group" : "personalInbox.direct") +
                    " · " +
                    r.id +
                    ")",
                )
                .join("\n");
          const result = await dialog.showMessageBox(win, {
            type: "question",
            message: translate("personalInbox.exactConsent"),
            detail: [
              translate("personalInbox.exactRetention"),
              grant.origin,
              grant.owner,
              roomNames,
              grant.question,
              grant.answer,
              new Date(grant.expires).toLocaleString(),
            ].join("\n\n"),
            buttons: [translate("native.common.cancel"), translate("personalInbox.exactOffer")],
            defaultId: 0,
            cancelId: 0,
          });
          return result.response === 1;
        },
        origin: base,
        current,
        profile: () => localView("/api/ai-twin"),
        exactProfile: () => localView("/api/ai-twin/inbox-exact-lessons"),
        inbox: accountRequest(base, current),
        approve: async ({ origin, fingerprint, owner, twin }) => {
          const answer = await dialog.showMessageBox(win, {
            type: "question",
            message: translate("personalInbox.pairCompare"),
            detail: [origin, owner, twin, fingerprint].join("\n"),
            buttons: [translate("native.common.cancel"), translate("personalInbox.pairMatch")],
            defaultId: 0,
            cancelId: 0,
          });
          return answer.response === 1;
        },
      });
      pairing = instance;
      const contents = win.webContents;
      const dispose = () => {
        instance.reset();
        void instance.exact.recover().catch(() => {});
        if (generatedJournal.hasPending()) void instance.generated.recover().catch(() => {});
        clearTimeout(timer);
        clearInterval(poll);
        win.removeListener("closed", dispose);
        if (!contents.isDestroyed()) {
          contents.removeListener("did-start-navigation", leaving);
          contents.removeListener("render-process-gone", dispose);
        }
        if (pairing === instance) {
          pairing = undefined;
          disposePairing = undefined;
        }
      };
      const leaving = (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) dispose();
      };
      let bootstrapExpired = false;
      const poll = setInterval(() => {
        if (bootstrapExpired && !instance.generated.whileOpen()) return dispose();
        void instance.exact.tick();
        void instance.generated.tick();
      }, 1500);
      poll.unref();
      const timer = setTimeout(() => {
        bootstrapExpired = true;
        if (!instance.generated.whileOpen()) dispose();
        else instance.exact.reset();
      }, 600_000);
      timer.unref();
      disposePairing = dispose;
      contents.on("did-start-navigation", leaving);
      contents.once("render-process-gone", dispose);
      win.once("closed", dispose);
      try {
        return await instance.start();
      } catch (error) {
        dispose();
        throw error;
      }
    });
    async function readGeneratedStatus() {
      if (pairing) return pairing.generated.status();
      const ctx = standalone(generatedJournal);
      return generatedStatus(ctx.inbox, await recoverGenerated(ctx));
    }
    handle("personal-inbox:twin-generated-status", async () => {
      try { return await readGeneratedStatus(); }
      catch (error) { if (generatedJournal.hasPending()) return { available: false, pendingRecovery: true }; throw error; }
    });
    handle("personal-inbox:twin-generated-choices", () => pairing?.generated.choices() ?? Promise.reject(Error("generated_reply_unavailable")));
    handle("personal-inbox:twin-generated-offer", (_e, provider, rooms, dailyLimit) => pairing?.generated.offer(provider, rooms, dailyLimit) ?? false);
    handle("personal-inbox:twin-generated-stop", async (_e, target) => {
      pairing?.generated.reset();
      const ctx = standalone(generatedJournal), me = await recoverGenerated(ctx);
      if (target) {
        if (target.owner !== me.id || typeof target.id !== "string") throw Error("generated_reply_unavailable");
        const receipt = await ctx.inbox("twin-generated", { action: "revoke", owner: me.id, id: target.id });
        if (receipt.id !== target.id || receipt.revoked !== true) throw Error("generated_reply_unavailable");
      }
      return readGeneratedStatus();
    });
    handle(
      "personal-inbox:twin-exact-choices",
      () => pairing?.exact.choices() ?? Promise.reject(Error("exact_reply_unavailable")),
    );
    handle("personal-inbox:twin-exact-offer", (_e, lesson, rooms) => pairing?.exact.offer(lesson, rooms) ?? false);
    handle("personal-inbox:twin-exact-stop", async (_event, target) => {
      pairing?.exact.reset();
      const context = standalone();
      const me = await recoverExact(context);
      if (target) {
        if (target.owner !== me.id || typeof target.id !== "string") throw Error("exact_reply_unavailable");
        const receipt = await context.inbox("twin-exact", { action: "revoke", owner: target.owner, id: target.id });
        if (receipt.id !== target.id || !receipt.revoked) throw Error("exact_reply_unavailable");
      }
      return exactStatus();
    });
    handle("personal-inbox:twin-exact-status", async () => {
      try {
        return await exactStatus();
      } catch (error) {
        if (exactJournal.hasPending()) return { available: false, pendingRecovery: true };
        throw error;
      }
    });
    handle("personal-inbox:twin-pair-confirm", () => pairing?.confirm() ?? false);
    handle("personal-inbox:open", () => open());
    handle("personal-inbox:close", () => panels.get(window())?.close());
    handle("personal-inbox:bounds", (event, bounds) => {
      const win = window();
      const view = panels.get(win)?.view;
      if (!view) return;
      if (bounds === null) { view.setVisible(false); return; }
      if (!bounds || !["x", "y", "width", "height"].every(key => Number.isFinite(bounds[key]))) return;
      const zoom = event.sender.getZoomFactor();
      const [width, height] = win.getContentSize();
      const x = Math.max(0, Math.min(width, Math.round(bounds.x * zoom)));
      const y = Math.max(0, Math.min(height, Math.round(bounds.y * zoom)));
      const w = Math.max(0, Math.min(width - x, Math.floor(bounds.width * zoom)));
      const h = Math.max(0, Math.min(height - y, Math.floor(bounds.height * zoom)));
      if (w && h) view.setBounds({ x, y, width: w, height: h });
      view.setVisible(!!(w && h));
    });
    handle("personal-inbox:create", async (_event, draft) => {
      const base = origin();
      if (!base) return "unavailable";
      if (!draft || !/^[a-f0-9-]{36}$/.test(draft.id) || typeof draft.title !== "string" || draft.title.length > 80
        || !Array.isArray(draft.emails) || draft.emails.length < 1 || draft.emails.length > 8) return "invalid_request";
      const emails = [...new Set(draft.emails.map(cleanEmail))];
      if (emails.some(email => !email) || (!draft.title && emails.length !== 1)) return "invalid_request";
      const guest = { locale: languageKey(), note: "" };
      const input = draft.title
        ? { kind: "group", id: draft.id, title: draft.title, invitees: emails, guest }
        : { kind: "direct", id: draft.id, email: emails[0], instant: true, guest };
      const response = await session.fromPartition(partition).fetch(base + "/api/rooms", {
        method: "POST", credentials: "include", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Origin: base, "Content-Type": "application/json", "x-inbox-language": locale(), "x-inbox-language-source": "app" },
        body: JSON.stringify(input),
      });
      if (response.status === 401) return "unauthorized";
      if (response.status === 429) return "rate_limited";
      if (response.status === 409) return "room_limit_or_conflict";
      if (!response.ok) return response.status === 400 ? "invalid_request" : "unavailable";
      const { id } = await response.json();
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return "unavailable";
      await open(false, id);
      return "ok";
    });
    const updates = personalAccountUpdates({ account: () => session.fromPartition(partition), origin, previousChoice,
      deviceChoice: () => jsonFile(path.join(app.getPath("userData"), "personal-email-updates.json")) });
    handle("personal-account:updates", () => updates());
    handle("personal-account:set-updates", (_event, enabled) => {
      if (typeof enabled !== "boolean") throw Error("Invalid email preference");
      return updates(enabled);
    });
    handle("personal-account:open", () => open(true));
    handle("personal-account:state", () => personalAccountEmail(origin()));
    async function auth(email, otp) {
      const address = cleanEmail(email);
      if (!address || (otp !== undefined && (typeof otp !== "string" || !/^\d{8}$/.test(otp)))) return "invalid";
      const base = origin();
      if (!base) return "unavailable";
      const verify = otp !== undefined;
      const response = await session.fromPartition(partition).fetch(base + (verify
        ? "/api/auth/sign-in/email-otp" : "/api/auth/email-otp/send-verification-otp"), {
        method: "POST", credentials: "include", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Origin: base, "Content-Type": "application/json", "x-inbox-language": locale(), "x-inbox-language-source": "app" },
        body: JSON.stringify(verify ? { email: address, otp } : { email: address, type: "sign-in" }),
      });
      if (response.status === 429) return "limited";
      if (!response.ok) return response.status >= 500 ? "unavailable" : "invalid";
      return "ok";
    }
    handle("personal-account:send-code", (_event, email) => auth(email));
    handle("personal-account:verify", async (event, email, code) => {
      if (typeof code !== "string") return "invalid";
      const result = await auth(email, code);
      if (result === "ok" && !event.sender.isDestroyed()) event.sender.send("personal-account:changed");
      return result;
    });
    handle("personal-account:sign-out", async event => {
      await signOutPersonalAccount(origin());
      panels.get(window())?.close();
      if (!event.sender.isDestroyed()) event.sender.send("personal-account:changed");
    });
  }
  function applySkin(win, skin) {
    skins.set(win, skin);
    const page = panels.get(win)?.view.webContents;
    if (page && !page.isDestroyed()) {
      void page.executeJavaScript("document.documentElement.dataset.skin = " + JSON.stringify(skin)).catch(() => {});
    }
  }
  function applyLanguage(win) {
    const page = panels.get(win)?.view.webContents;
    if (page && !page.isDestroyed()) {
      const tag = JSON.stringify(locale());
      void page.executeJavaScript('window.dispatchEvent(new CustomEvent("inbox-language", { detail: ' + tag + ' }))').catch(() => {});
    }
  }
  return { open, origin, install, applySkin, applyLanguage, watchIdentities };
}
