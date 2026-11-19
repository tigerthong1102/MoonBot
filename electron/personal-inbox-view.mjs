import { WebContentsView } from "electron";

const panels = new WeakMap();

export async function showPersonalInbox(window, origin) {
  if (!window || window.isDestroyed() || !origin) return;
  const existing = panels.get(window);
  if (existing) {
    existing.webContents.focus();
    return;
  }
  const view = new WebContentsView({ webPreferences: {
    partition: "persist:startupbot-personal-inbox",
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
    await page.loadURL(origin + "/?desktop=1&lang=vi");
    if (!page.isDestroyed()) page.focus();
  } catch (error) {
    if (panels.get(window) !== view) return;
    close();
    throw error;
  }
}
