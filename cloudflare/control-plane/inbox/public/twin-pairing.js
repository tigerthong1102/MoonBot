export function installTwinPairing({ api, me, t, el }) {
  const panel = el("twin-pairing"),
    form = el("twin-pair-form"),
    review = el("twin-pair-review");
  const status = el("twin-pair-status"),
    list = el("twin-pair-active"),
    fingerprint = el("twin-pair-fingerprint");
  let candidate,
    timer,
    generation = 0;
  const reset = () => {
    generation++;
    clearTimeout(timer);
    candidate = null;
    form.reset();
    review.hidden = true;
    fingerprint.textContent = "";
    list.replaceChildren();
    status.textContent = "";
  };
  async function withAccount(work) {
    const owner = me()?.id,
      version = generation;
    if (!owner) return;
    const live = () => me()?.id === owner && generation === version && panel.open;
    const post = (data) => api("twin-pairing", { ...data, owner });
    try {
      await work({ owner, live, post });
    } catch {
      if (live()) status.textContent = t("personalInbox.pairError");
    }
  }
  async function refresh() {
    return withAccount(async ({ owner, live, post }) => {
      const result = await api("twin-pairing");
      if (!live() || result.owner !== owner) return;
      clearTimeout(timer);
      const current = result.pairings.filter((pair) => pair.expires > result.now);
      if (current.length)
        timer = setTimeout(
          () => {
            list.replaceChildren();
            void refresh();
          },
          Math.max(1, Math.min(...current.map((pair) => pair.expires)) - result.now),
        );
      list.replaceChildren(
        ...current.map((pair) => {
          const li = document.createElement("li"),
            button = document.createElement("button");
          const key = document.createElement("code");
          key.dir = "ltr";
          key.textContent = pair.fingerprint;
          button.className = "ui-button";
          button.textContent = t("personalInbox.pairRevoke");
          button.onclick = () =>
            withAccount(async ({ live: stillHere }) => {
              if (!live()) return;
              await post({ action: "revoke", id: pair.id });
              if (stillHere()) {
                status.textContent = t("personalInbox.pairRevoked");
                await refresh();
              }
            });
          li.append(key, " · ", new Date(pair.expires).toLocaleTimeString(), " ", button);
          return li;
        }),
      );
    });
  }
  window.addEventListener("focus", () => {
    if (panel.open) {
      list.replaceChildren();
      void refresh();
    }
  });
  panel.ontoggle = () => {
    reset();
    if (panel.open) void refresh();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    candidate = null;
    review.hidden = true;
    const id = form.elements.ticket.value.trim();
    generation++;
    void withAccount(async ({ live, post }) => {
      const result = await post({ action: "inspect", id });
      if (!live()) return;
      candidate = result;
      fingerprint.textContent = result.fingerprint;
      review.hidden = false;
      status.textContent = "";
    });
  };
  el("twin-pair-confirm").onclick = () =>
    withAccount(async ({ owner, live, post }) => {
      if (!candidate || candidate.owner !== owner) return;
      await post({ action: "confirm", id: candidate.id, fingerprint: candidate.fingerprint });
      if (live()) {
        reset();
        status.textContent = t("personalInbox.pairDone");
        await refresh();
      }
    });
  return reset;
}
