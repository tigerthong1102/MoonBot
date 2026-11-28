import { randomUUID } from "node:crypto";
import { BrowserWindow, session } from "electron";
import { companionAccountCleanupPending, storedAccount } from "./companion-account-documents.mjs";

const cookieName = "__Host-startupbot-mobile";

export function createMobileAccountChatWindow(environment) {
  const configured = environment.STARTUPBOT_ACCOUNT_CHAT_ORIGIN;
  if (!configured) return () => {};
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.origin !== configured || url.origin !== environment.OMB_CONTROL_PLANE_URL)
    throw Error("Account chat requires the configured HTTPS account service");
  let current;
  function stop(entry) {
    clearTimeout(entry.timer);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    void entry.partition.clearStorageData().catch(() => {});
  }
  async function signIn(entry) {
    try {
      const response = await fetch(url.origin + "/mobile/login", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
        headers: { origin: url.origin, authorization: "Bearer " + entry.account.accountToken, "content-type": "application/json" },
        body: JSON.stringify({ client: "desktop-account", account: entry.account.userId, email: entry.account.email }),
      });
      if (!response.ok) throw Error("Account service unavailable");
      const cookie = response.headers.getSetCookie().find(line => line.startsWith(cookieName + "="));
      const handle = cookie?.split(";", 1)[0].slice(cookieName.length + 1);
      if (!handle || !/^[A-Za-z0-9_-]{43}$/.test(handle)) throw Error("Account session unavailable");
      if (current !== entry || entry.window.isDestroyed()) return;
      await entry.partition.cookies.set({ url:url.origin, name:cookieName, value:handle, path:"/", secure:true, httpOnly:true, sameSite:"strict" });
      if (current !== entry || entry.window.isDestroyed()) return;
      if (!entry.loaded) {
        await entry.window.loadURL(url.origin + "/mobile?lang=vi");
        if (current !== entry || entry.window.isDestroyed()) return;
        entry.loaded = true;
        entry.window.show();
      }
      entry.timer = setTimeout(() => void signIn(entry), 7 * 3600_000);
    } catch {
      if (current === entry && !entry.window.isDestroyed()) {
        entry.timer = setTimeout(() => void signIn(entry), 20000);
      }
    }
  }
  return credentials => {
    const account = !companionAccountCleanupPending(credentials) && storedAccount(credentials);
    if (current && !current.window.isDestroyed() && account?.userId === current.account.userId && account?.accountToken === current.account.accountToken) return;
    const previous = current;
    current = undefined;
    if (previous) stop(previous);
    if (!account?.accountToken) return;
    const partition = session.fromPartition("account-chat-" + randomUUID());
    partition.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    partition.setPermissionCheckHandler(() => false);
    const window = new BrowserWindow({ width: 920, height: 760, show:false, title:"StartupBot",
      webPreferences:{session:partition,sandbox:true,contextIsolation:true,nodeIntegration:false} });
    const entry = { account, partition, window, timer:undefined, loaded:false };
    current = entry;
    window.webContents.setWindowOpenHandler(() => ({ action:"deny" }));
    const restrict = (event, target) => { if (new URL(target).origin !== url.origin) event.preventDefault(); };
    window.webContents.on("will-navigate", restrict);
    window.webContents.on("will-redirect", restrict);
    window.on("closed", () => { clearTimeout(entry.timer); void partition.clearStorageData().catch(() => {}); });
    void signIn(entry);
  };
}
