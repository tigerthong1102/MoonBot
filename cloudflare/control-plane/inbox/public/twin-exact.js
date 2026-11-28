export function installExactReview({ api, me, t, el }) {
  const panel = el("twin-exact"),
    terms = el("exact-terms"),
    status = el("exact-status");
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
      const result = await api("twin-exact"),
        g = result.grant;
      if (!live() || result.owner !== owner) return;
      if (!g) {
        status.textContent = t("personalInbox.exactOff");
        return;
      }
      if (!Number.isSafeInteger(result.now) || g.expires <= result.now) throw Error("expired");
      timer = setTimeout(() => void refresh(), Math.max(250, g.expires - result.now));
      const post = (action, extra = {}) => api("twin-exact", { owner, id: g.id, action, ...extra });
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
      const scope = await api("twin-exact?rooms=1");
      if (!live() || scope.owner !== owner) return;
      const all = g.rooms.length === 1 && g.rooms[0] === "*";
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
        ...(g.reviewer ? [g.question, g.answer] : []),
        names,
        new Date(g.expires).toLocaleString(),
        g.count + " / 20",
      ]) {
        const p = document.createElement("p");
        p.dir = "auto";
        p.textContent = text;
        terms.append(p);
      }
      button("personalInbox.exactStop", () => post("revoke"));
      status.textContent = t(g.enabled ? "personalInbox.exactEnabled" : "personalInbox.exactPending");
      if (g.enabled || !g.reviewer || selected.some((r) => !r)) return;
      const inspected = await post("inspect");
      if (!live() || inspected.id !== g.id) return;
      button("personalInbox.exactAllow", () =>
        post("approve", { review: inspected.review, purpose: "one-exact-owner-lesson-v1" }),
      );
    } catch {
      if (live()) status.textContent = t("personalInbox.exactUnavailable");
    }
  }
  panel.ontoggle = () => (panel.open ? void refresh() : reset());
  el("exact-check").onclick = () => void refresh();
  window.addEventListener("focus", () => {
    if (panel.open) void refresh();
  });
  return reset;
}
