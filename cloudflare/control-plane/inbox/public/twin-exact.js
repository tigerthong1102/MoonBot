export function installExactReview({ api, me, t, el, generated = false }) {
  const mode = generated ? "generated" : "exact";
  const route = "twin-" + mode;
  const panel = el(route),
    terms = el(mode + "-terms"),
    status = el(mode + "-status");
  let generation = 0,
    timer, recoveryOwner;
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
      if (generated && (me().generatedManageOnly || recoveryOwner === owner)) {
        const fresh = await api("me");
        if (!live() || fresh.id !== owner) return;
        if (!fresh.generatedManageOnly && !fresh.generatedAnswer) {
          status.textContent = t("personalInbox.generatedOff");
          return;
        }
      }
      const result = await api(route),
        g = result.grant;
      if (!live() || result.owner !== owner) return;
      if (generated) recoveryOwner = result.manageOnly ? owner : undefined;
      if (!g) {
        status.textContent = t(generated ? "personalInbox.generatedOff" : "personalInbox.exactOff");
        return;
      }
      const ongoing = generated && g.dailyLimit !== undefined;
      if (ongoing && (!Number.isInteger(g.dailyLimit) || g.dailyLimit < 1 || g.dailyLimit > 720)) throw Error("limit");
      const lapsed = g.expires <= result.now;
      if (!Number.isSafeInteger(result.now) || (lapsed && !(ongoing && g.enabled && g.authorizedUntil > result.now))) throw Error("expired");
      timer = setTimeout(() => void refresh(), lapsed ? 60000 : Math.max(250, g.expires - result.now));
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
      const future = generated && g.rooms.length > 0 && g.rooms.every(ref => ref === "all-direct" || ref === "all-managed-groups");
      const selected = all || future ? [] : g.rooms.map((id) => scope.rooms.find((r) => r.ref === id && r.title));
      const names = future ? g.rooms.map(ref => t(ref === "all-direct" ? "personalInbox.generatedAllDirect" : "personalInbox.generatedAllGroups")).join("\n") : all
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
        ongoing ? t("personalInbox.generatedLeaseAt", {time:new Date(g.expires).toLocaleString()}) : new Date(g.expires).toLocaleString(),
        ...(ongoing && Number.isSafeInteger(g.authorizedUntil) ? [t("personalInbox.generatedAuthorityUntil", {time:new Date(g.authorizedUntil).toLocaleString()})] : []),
        ...(ongoing && Number.isSafeInteger(g.usedToday) ? [t("personalInbox.generatedUsage", {recent:g.count,today:g.usedToday,count:g.dailyLimit})] : []),
        ...(ongoing ? [t("personalInbox.generatedOngoingTerms", { count:g.dailyLimit })] : [g.count + (generated ? " / 5" : " / 20")]),
      ]) {
        const p = document.createElement("p");
        p.dir = "auto";
        p.textContent = text;
        terms.append(p);
      }
      button(generated ? "personalInbox.generatedStop" : "personalInbox.exactStop", async () => {
        const receipt = await post("revoke");
        if (receipt.id !== g.id || receipt.revoked !== true) throw Error("revoke_unconfirmed");
      });
      status.textContent = t(generated ? (g.enabled ? "personalInbox.generatedEnabled" : "personalInbox.generatedPending") : (g.enabled ? "personalInbox.exactEnabled" : "personalInbox.exactPending"));
      if (ongoing && g.enabled) status.textContent = t(result.manageOnly || me().generatedManageOnly ? "personalInbox.generatedManageOnly" : lapsed ? "personalInbox.generatedOngoingWaiting" : "personalInbox.generatedOngoingEnabled", {count:g.dailyLimit});
      if ((generated && (result.manageOnly || me().generatedManageOnly)) || g.enabled || !g.reviewer || selected.some((r) => !r)) return;
      const inspected = await post("inspect");
      if (!live() || inspected.id !== g.id) return;
      button(generated ? "personalInbox.generatedAllow" : "personalInbox.exactAllow", () =>
        post("approve", { review: inspected.review, purpose: ongoing ? "generated-while-online-v3" : future ? "generated-current-and-future-inbox-v2" : generated ? "generated-inbox-answer-v1" : "one-exact-owner-lesson-v1" }),
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
