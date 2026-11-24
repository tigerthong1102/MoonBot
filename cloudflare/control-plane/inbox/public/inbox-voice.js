import { connectMobileVoice } from "./mobile-inbox-voice.js";

const formats = [
  ["audio/mp4;codecs=mp4a.40.2", "m4a"],
  ["audio/webm;codecs=opus", "webm"],
  ["audio/mp4", "m4a"],
];
const recordingFormats = () => typeof MediaRecorder === "function"
  ? formats.filter(([type]) => MediaRecorder.isTypeSupported(type))
  : [];

export function voiceComposer({ recordButton, dictateButton, cancelButton, status, draft, desktop, eligible, maxBytes, stage, changed, error, t }) {
  let bridge = window.startupbotInboxVoice;
  let active = null;
  const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());
  const supportsRecording = Boolean((!desktop || bridge) && navigator.mediaDevices?.getUserMedia && recordingFormats().length);
  const update = () => {
    recordButton.hidden = !supportsRecording || !maxBytes();
    dictateButton.hidden = !bridge;
    recordButton.disabled = !eligible() || (active !== null && active.type !== "record");
    dictateButton.disabled = !eligible() || (active !== null && active.type !== "dictate");
    const label = (button, key, pressed) => {
      const text = t(key);
      button.title = text;
      button.setAttribute("aria-label", text);
      button.setAttribute("aria-pressed", String(pressed));
    };
    label(recordButton, active?.type === "record" ? "personalInbox.stopRecording" : "personalInbox.recordVoice", active?.type === "record");
    label(dictateButton, active?.type === "dictate" ? "composer.dictation.stop" : "composer.dictation.start", active?.type === "dictate");
    cancelButton.hidden = !active;
    cancelButton.setAttribute("aria-label", t("personalInbox.discardVoice"));
    cancelButton.title = t("personalInbox.discardVoice");
    status.hidden = !active;
    status.textContent = active?.type === "record" ?
      (active.recorder ? t("personalInbox.recordingVoice") : t("personalInbox.startingVoice")) :
      active ? t("personalInbox.dictatingVoice") : "";
  };
  function release(entry) {
    if (active !== entry) return false;
    active = null;
    clearTimeout(entry.timeout);
    stopTracks(entry.stream);
    changed();
    return true;
  }
  function discard() {
    const entry = active;
    if (!entry) return;
    release(entry);
    if (entry.recorder?.state === "recording") entry.recorder.stop();
    if (entry.type === "dictate") void bridge.dictate("cancel", entry.id).catch(() => {});
  }
  function stopRecording(entry) {
    if (!entry.recorder) { discard(); return; }
    if (entry.recorder.state === "recording") {
      entry.stopping = true;
      entry.recorder.stop();
      stopTracks(entry.stream);
    }
  }
  function startRecorder(entry, candidates) {
    entry.recorder = null;
    for (const [index, [mimeType, extension]] of candidates.entries()) {
      try {
        const recorder = new MediaRecorder(entry.stream, { mimeType, audioBitsPerSecond: 32000 });
        const chunks = [];
        const startedAt = performance.now();
        entry.recorder = recorder;
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = event => {
          if (active !== entry || entry.recorder !== recorder) return;
          if (!entry.stopping && !chunks.length && performance.now() - startedAt < 1000
            && ["EncodingError", "UnknownError", "NotSupportedError"].includes(event.error?.name)
            && entry.stream.getAudioTracks().some(track => track.readyState === "live")) {
            startRecorder(entry, candidates.slice(index + 1));
          } else if (release(entry)) error("voice_failed");
        };
        recorder.onstop = () => {
          if (entry.recorder !== recorder || !release(entry) || !eligible()) return;
          const file = new File(chunks, "startupbot-voice." + extension, { type: recorder.mimeType || mimeType });
          if (file.size > maxBytes()) error("voice_failed");
          else if (file.size) stage(file);
        };
        recorder.start();
        changed();
        return;
      } catch {
        entry.recorder = null;
      }
    }
    if (release(entry)) error("voice_failed");
  }
  async function record() {
    if (active?.type === "record") { stopRecording(active); return; }
    if (active || !eligible() || !maxBytes()) return;
    const candidates = recordingFormats();
    if (!candidates.length) return;
    const entry = {type: "record"};
    active = entry;
    changed();
    try {
      if (bridge && !(await bridge.requestMicrophone())) throw Error("voice_unavailable");
      if (active !== entry) return;
      const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation:true, noiseSuppression:true, autoGainControl:true}});
      if (active !== entry || !eligible()) { stopTracks(stream); release(entry); return; }
      entry.stream = stream;
      entry.timeout = setTimeout(() => stopRecording(entry), 60000);
      startRecorder(entry, candidates);
    } catch (cause) {
      if (release(entry)) error(cause?.name === "NotAllowedError" || cause?.name === "NotFoundError" || cause?.message === "voice_unavailable" ?
        "voice_unavailable" : "voice_failed");
    }
  }
  async function dictate() {
    if (!bridge) return;
    if (active?.type === "dictate") {
      const entry = active;
      if (entry.finishing) return;
      entry.finishing = true;
      if (!(await bridge.dictate("finish", entry.id)) && release(entry)) error("dictation_failed");
      return;
    }
    if (active || !eligible()) return;
    const entry = { id: crypto.randomUUID(), type: "dictate", base: draft.value, last: draft.value };
    active = entry;
    changed();
    entry.timeout = setTimeout(() => { if (active === entry) dictateButton.click(); }, 60000);
    try {
      if (!(await bridge.dictate("start", entry.id)) && release(entry)) error("dictation_unavailable");
    } catch {
      if (release(entry)) error("dictation_failed");
    }
  }
  function onDictation(message) {
    const entry = active;
    if (entry?.type !== "dictate" || entry.id !== message.id) return;
    if (typeof message.text === "string") {
      if (draft.value !== entry.last || !eligible()) { discard(); return; }
      const separator = entry.base && !/\s$/.test(entry.base) ? " " : "";
      entry.last = (entry.base + separator + message.text).slice(0, draft.maxLength);
      draft.value = entry.last;
      changed();
    } else if (release(entry) && message.status !== "done") {
      error(message.status === "unavailable" ? "dictation_unavailable" : "dictation_failed");
    }
  }
  if (bridge) bridge.onDictation(onDictation);
  else bridge = connectMobileVoice(onDictation, connected => { bridge = connected; changed(); });
  recordButton.onclick = () => void record();
  dictateButton.onclick = () => void dictate().catch(() => { discard(); error("dictation_failed"); });
  cancelButton.onclick = discard;
  draft.addEventListener("input", () => { if (active?.type === "dictate") discard(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && active) { event.preventDefault(); discard(); }
  });
  window.addEventListener("pagehide", discard);
  document.addEventListener("visibilitychange", () => { if (document.hidden) discard(); });
  return { update, discard, get active() { return Boolean(active); } };
}
export function isVoiceMessage(name) {
  return name === "startupbot-voice.webm" || name === "startupbot-voice.m4a";
}
