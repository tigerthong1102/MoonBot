import { personalAccountUpdates } from "./personal-account-updates.mjs";
import { cleanEmail } from "./cloud-signin.mjs";
import { personalInboxBots } from "./personal-inbox-bots.mjs";
import path from "node:path";
import { createRequire } from "node:module";
import { configuredInboxOrigin } from "./startupbot-identity.mjs";
import { jsonFile } from "./desktop-prefs.mjs";
import { app, session, systemPreferences, WebContentsView } from "electron";
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

export async function showPersonalInbox(window, origin, language, requestSignIn, { localWorkspace }) {
  if (!window || window.isDestroyed() || !origin) return;
  const existing = panels.get(window);
  if (existing) {
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
  const bots = personalInboxBots(window, page, origin);
  const disposeVoice = registerInboxVoice({ page, workspace, origin, localWorkspace, requestMicrophone, canStartDictation: () => !speechBusy() });
  const invitePath = origin + "/desktop/invite-bot/";
  page.setWindowOpenHandler(({ url }) => {
    if (bots && url.startsWith(invitePath)) bots.invite(url.slice(invitePath.length));
    return { action: "deny" };
  });
  const fit = () => {
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: 40, width, height: Math.max(1, height - 40) });
  };
  const close = () => {
    if (panels.get(window) !== view) return;
    panels.delete(window);
    disposeVoice.close();
    window.off("resize", fit);
    window.off("closed", close);
    workspace.off("did-navigate", close);
    if (!window.isDestroyed()) {
      window.contentView.removeChildView(view);
      workspace.focus();
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
  panels.set(window, view);
  window.contentView.addChildView(view);
  window.on("resize", fit);
  window.once("closed", close);
  workspace.once("did-navigate", close);
  fit();
  try {
    const params = new URLSearchParams({ desktop: "1", hostAuth: "1", lang: language });
    if (skins.has(window)) params.set("skin", skins.get(window));
    if (bots) params.set("bots", "1");
    await page.loadURL(origin + "/?" + params);
    if (!page.isDestroyed()) page.focus();
  } catch (error) {
    if (panels.get(window) !== view) return;
    close();
    throw error;
  }
}

export function createPersonalInbox({ window, locale, isLocal, showLocal, previousChoice }) {
  const metadata = createRequire(import.meta.url)("../package.json");
  function origin() {
    return configuredInboxOrigin(process.env.STARTUPBOT_INBOX_ORIGIN, metadata.startupbotInboxOrigin,
      jsonFile(path.join(app.getPath("userData"), "inbox-service.json")).read);
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
  async function open(accountOnly = false) {
    const win = window();
    win.show();
    if (accountOnly) return requestSignIn(win, false);
    const existing = panels.get(win);
    if (existing) { existing.webContents.focus(); return; }
    const base = origin();
    const email = await personalAccountEmail(base);
    if (win.isDestroyed()) return;
    if (!email) return requestSignIn(win, true);
    await waitForWorkspace(win);
    return showPersonalInbox(win, base, locale(), () => requestSignIn(win, true), {
      localWorkspace: () => !win.isDestroyed() && isLocal(win),
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
    handle("personal-inbox:open", () => open());
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
      if (!event.sender.isDestroyed()) event.sender.send("personal-account:changed");
    });
  }
  function applySkin(win, skin) {
    skins.set(win, skin);
    const page = panels.get(win)?.webContents;
    if (page && !page.isDestroyed()) {
      void page.executeJavaScript("document.documentElement.dataset.skin = " + JSON.stringify(skin)).catch(() => {});
    }
  }
  function applyLanguage(win) {
    const page = panels.get(win)?.webContents;
    if (page && !page.isDestroyed()) {
      const tag = JSON.stringify(locale());
      void page.executeJavaScript('window.dispatchEvent(new CustomEvent("inbox-language", { detail: ' + tag + ' }))').catch(() => {});
    }
  }
  return { open, origin, install, applySkin, applyLanguage };
}
