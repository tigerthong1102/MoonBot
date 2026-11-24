import { mainFrameMicrophoneAllowed } from "./app-permissions.mjs";

const views = new WeakMap();
const inboxPages = new WeakMap();

function inboxFrame(event) {
  const voice = views.get(event.sender);
  const frame = event.senderFrame;
  if (!voice || !frame || frame !== event.sender.mainFrame || !voice.isHome(frame.url)) return null;
  return voice;
}

export function registerInboxVoice({ page, workspace, origin, localWorkspace, requestMicrophone }) {
  const isHome = (value) => {
    const url = URL.canParse(value) ? new URL(value) : null;
    return url?.origin === origin && url.pathname === "/";
  };
  const voice = { workspace, localWorkspace, requestMicrophone, isHome, microphoneUntil: 0, dictation: null };
  views.set(page, voice);
  inboxPages.set(workspace, page);
  const allowed = (contents, permission, requesting, details) => {
    const active = views.get(contents);
    return active && active.microphoneUntil >= Date.now() && active.isHome(contents.getURL()) &&
      mainFrameMicrophoneAllowed(permission, requesting, new URL(contents.getURL()).origin, details);
  };
  page.session.setPermissionCheckHandler((contents, permission, origin, details) =>
    Boolean(allowed(contents, permission, origin, details)));
  page.session.setPermissionRequestHandler((contents, permission, reply, details) =>
    reply(Boolean(details?.requestingUrl && allowed(contents, permission, details.requestingUrl, details))));
  const reset = () => {
    voice.microphoneUntil = 0;
    endDictation(voice);
  };
  return { reset, close: () => { views.delete(page); inboxPages.delete(workspace); reset(); } };
}

function endDictation(voice) {
  const id = voice.dictation;
  voice.dictation = null;
  if (id && !voice.workspace.isDestroyed() && voice.localWorkspace())
    voice.workspace.send("personal-inbox:dictation-command", { id, action: "cancel" });
}

export function installInboxVoice(ipc, localOnly, requireMainWindowSender) {
  ipc.handle("personal-inbox:request-microphone", async event => {
    const voice = inboxFrame(event);
    if (!voice || voice.dictation || !(await voice.requestMicrophone()) || inboxFrame(event) !== voice || voice.dictation) return false;
    voice.microphoneUntil = Date.now() + 5000;
    return true;
  });
  ipc.handle("personal-inbox:dictate", (event, action, id) => {
    const voice = inboxFrame(event);
    if (!voice || voice.workspace.isDestroyed() || !voice.localWorkspace()) return false;
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return false;
    if (action === "cancel" && voice.dictation === id) {
      endDictation(voice);
      return true;
    }
    if (action === "start" && !voice.dictation) voice.dictation = id;
    else if (action !== "finish" || voice.dictation !== id) return false;
    voice.microphoneUntil = 0;
    voice.workspace.send("personal-inbox:dictation-command", { id: voice.dictation, action });
    return true;
  });
  ipc.handle("personal-inbox:dictation-result", localOnly("personal-inbox:dictation-result", (event, id, result) => {
    requireMainWindowSender(event);
    const page = inboxPages.get(event.sender);
    const voice = page && views.get(page);
    if (!voice || !voice.dictation || voice.dictation !== id || voice.workspace !== event.sender || !voice.isHome(page.getURL())) return;
    if (typeof result?.text === "string") {
      page.send("personal-inbox:dictation", { id, text: result.text.slice(0, 8000) });
    } else if (["done", "failed", "unavailable"].includes(result?.status)) {
      voice.dictation = null;
      page.send("personal-inbox:dictation", { id, status: result.status });
    }
  }));
}
