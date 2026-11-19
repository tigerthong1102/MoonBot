import path from "node:path";
import { createRequire } from "node:module";
import { configuredInboxOrigin } from "./startupbot-identity.mjs";
import { jsonFile } from "./desktop-prefs.mjs";
import { app, session, WebContentsView } from "electron";

const panels = new WeakMap();
const partition = "persist:startupbot-personal-inbox";

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

export async function showPersonalInbox(window, origin, accountOnly = false, language = app.getLocale()) {
  if (!window || window.isDestroyed() || !origin) return;
  const existing = panels.get(window);
  if (existing) {
    existing.webContents.focus();
    return;
  }
  const view = new WebContentsView({ webPreferences: {
    partition,
    nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false,
  } });
  const page = view.webContents;
  const workspace = window.webContents;
  page.session.setPermissionCheckHandler(() => false);
  page.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  page.setWindowOpenHandler(() => ({ action: "deny" }));
  const fit = () => {
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: 40, width, height: Math.max(1, height - 40) });
  };
  const close = () => {
    if (panels.get(window) !== view) return;
    panels.delete(window);
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
    if (target === origin + "/desktop/back") {
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
  panels.set(window, view);
  window.contentView.addChildView(view);
  window.on("resize", fit);
  window.once("closed", close);
  workspace.once("did-navigate", close);
  fit();
  try {
    const params = new URLSearchParams({ desktop: "1", lang: language });
    if (accountOnly) params.set("account", "1");
    await page.loadURL(origin + "/?" + params);
    if (!page.isDestroyed()) page.focus();
  } catch (error) {
    if (panels.get(window) !== view) return;
    close();
    throw error;
  }
}

export function createPersonalInbox(window, locale = () => app.getLocale()) {
  const metadata = createRequire(import.meta.url)("../package.json");
  function origin() {
    return configuredInboxOrigin(process.env.STARTUPBOT_INBOX_ORIGIN, metadata.startupbotInboxOrigin,
      jsonFile(path.join(app.getPath("userData"), "inbox-service.json")).read);
  }
  function open(accountOnly = false) {
    const win = window();
    win.show();
    return showPersonalInbox(win, origin(), accountOnly, locale());
  }
  function install(ipcMain, localOnly, requireMainWindowSender) {
    function handle(channel, action) {
      ipcMain.handle(channel, localOnly(channel, event => {
        requireMainWindowSender(event);
        return action(event);
      }));
    }
    handle("personal-inbox:open", () => open());
    handle("personal-account:open", () => open(true));
    handle("personal-account:state", () => personalAccountEmail(origin()));
    handle("personal-account:sign-out", async event => {
      await signOutPersonalAccount(origin());
      if (!event.sender.isDestroyed()) event.sender.send("personal-account:changed");
    });
  }
  return { open, origin, install };
}
