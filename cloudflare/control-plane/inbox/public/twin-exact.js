export function installExactReview({ api, me, t, el, generated = false }) {
  const mode = generated ? "generated" : "exact";
  const route = "twin-" + mode;
  const panel = el(route),
    terms = el(mode + "-terms"),
    status = el(mode + "-status");
  let generation = 0,
    timer;
  function reset() {
    generation++;
    clearTimeout(timer);
    terms.replaceChildren();
    status.textContent = "";
  }
  async function refresh() {
    reset();
    const run = generation,
      owner = me()?.id;
    const live = () => run === generation && me()?.id === owner && panel.open;
    if (!owner || !live()) return;
    try {
      const result = await api(route),
        g = result.grant;
      if (!live() || result.owner !== owner) return;
      if (!g) {
        status.textContent = t("personalInbox.exactOff");
        return;
      }
      if (!Number.isSafeInteger(result.now) || g.expires <= result.now) throw Error("expired");
      timer = setTimeout(() => void refresh(), Math.max(250, g.expires - result.now));
      const post = (action, extra = {}) => api(route, { owner, id: g.id, action, ...extra });
      function button(key, apply) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ui-button";
        b.textContent = t(key);
        b.onclick = async () => {
          if (!live()) return;
          b.disabled = true;
          try {
            await apply();
            if (live()) await refresh();
          } catch {
            if (live()) {
              status.textContent = t("personalInbox.exactUnavailable");
              b.disabled = false;
            }
          }
        };
        terms.append(b);
      }
      const scope = await api(route + "?rooms=1");
      if (!live() || scope.owner !== owner) return;
      const all = !generated && g.rooms.length === 1 && g.rooms[0] === "*";
      const selected = all ? [] : g.rooms.map((id) => scope.rooms.find((r) => r.ref === id && r.title));
      const names = all
        ? t("personalInbox.exactAll")
        : selected
            .map((r) =>
              r
                ? r.title +
                  " (" +
                  t(r.kind === "group" ? "personalInbox.group" : "personalInbox.direct") +
                  " · " +
                  r.id +
                  ")"
                : "—",
            )
            .join("\n");
      for (const text of [
        location.origin,
        me().email,
        ...(generated ? [g.provider.name, g.provider.model, g.provider.destination] : g.reviewer ? [g.question, g.answer] : []),
        names,
        new Date(g.expires).toLocaleString(),
        g.count + (generated ? " / 5" : " / 20"),
      ]) {
        const p = document.createElement("p");
        p.dir = "auto";
        p.textContent = text;
        terms.append(p);
      }
      button(generated ? "personalInbox.generatedStop" : "personalInbox.exactStop", () => post("revoke"));
      status.textContent = t(generated ? (g.enabled ? "personalInbox.generatedEnabled" : "personalInbox.generatedPending") : (g.enabled ? "personalInbox.exactEnabled" : "personalInbox.exactPending"));
      if (g.enabled || !g.reviewer || selected.some((r) => !r)) return;
      const inspected = await post("inspect");
      if (!live() || inspected.id !== g.id) return;
      button(generated ? "personalInbox.generatedAllow" : "personalInbox.exactAllow", () =>
        post("approve", { review: inspected.review, purpose: generated ? "generated-inbox-answer-v1" : "one-exact-owner-lesson-v1" }),
      );
    } catch {
      if (live()) status.textContent = t("personalInbox.exactUnavailable");
    }
  }
  panel.ontoggle = () => (panel.open ? void refresh() : reset());
  el(mode + "-check").onclick = () => void refresh();
  window.addEventListener("focus", () => {
    if (panel.open) void refresh();
  });
  return reset;
}
