import { EventEmitter } from "node:events";

export function watchInboxIdentities({ win, origin, isLocal, inboxSession, localRequest, locale, startBots }) {
  const web = win.webContents;
  let page;
  const stop = () => { if (page) { page.dead = true; page.emit("destroyed"); page = undefined; } };
  const start = () => {
    stop();
    const base = origin();
    if (!base || win.isDestroyed() || !isLocal(win)) return;
    const observer = new EventEmitter();
    observer.dead = false; observer.isDestroyed = () => observer.dead;
    observer.session = inboxSession(); observer.executeJavaScript = async () => {};
    if (startBots(win, observer, base, localRequest, locale(), { identityOnly: true })) page = observer;
  };
  const navigating = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) stop(); };
  const close = () => { stop(); web.off("did-finish-load", start); web.off("did-start-navigation", navigating); };
  web.on("did-finish-load", start);
  web.on("did-start-navigation", navigating);
  win.once("closed", close);
  if (web.getURL() && !web.isLoadingMainFrame()) start();
}
