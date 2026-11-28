export function prepareInboxPost(previous, { room, kind, body, generatedNotice }) {
  if (!body) return null;
  if (previous?.room === room && previous.kind === kind && previous.body === body) {
    return { ...previous, generatedNotice: previous.generatedNotice === generatedNotice ? generatedNotice : undefined };
  }
  return { room, kind, body, generatedNotice, nonce: crypto.randomUUID() };
}

export function generatedComposerNotice({ api, me, room, el, t }) {
  const box = el("generated-notice"), draft = el("draft");
  let notice, roomId, owner, writing, version = 0;
  function emptyDraft() { writing = undefined; }
  function hide() {
    notice = undefined;
    box.hidden = true;
    box.textContent = "";
    if (draft.value) writing = null;
  }
  function reset() {
    version++;
    roomId = owner = undefined;
    hide();
    emptyDraft();
  }
  function forDraft() {
    return writing && notice?.id === writing && !box.hidden && roomId === room() && owner === me()?.id ? writing : undefined;
  }
  draft.addEventListener("input", () => {
    if (!draft.value) emptyDraft();
    else if (writing === undefined) writing = !box.hidden && notice ? notice.id : null;
  });
  async function refresh() {
    const seq = ++version, nextRoom = room(), nextOwner = me()?.id;
    if (!nextRoom || !nextOwner || !me()?.generatedAnswer) { reset(); return; }
    if (roomId !== nextRoom || owner !== nextOwner) hide();
    roomId = nextRoom; owner = nextOwner;
    const live = () => version === seq && room() === nextRoom && me()?.id === nextOwner;
    try {
      const result = await api("twin-generated?notice=" + encodeURIComponent(nextRoom));
      if (!live()) return;
      const next = result.notice;
      if (!next?.id || !next.provider?.name || !next.provider.model || !next.provider.destination) { hide(); return; }
      if (draft.value && next.id !== notice?.id) writing = null;
      notice = next;
      box.textContent = t("personalInbox.generatedNotice", next.provider);
      box.hidden = false;
    } catch { if (live()) hide(); }
  }
  return { reset, refresh, forDraft, emptyDraft };
}
