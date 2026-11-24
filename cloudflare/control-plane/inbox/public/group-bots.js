import { language, t } from "./inbox-i18n.js";

import { inboxSelect } from "./inbox-select.js";

export function groupBots({ room, me, node, button, api, refresh, status, manager, writable }) {
  const panel = node("details", "");
  panel.append(node("summary", t("personalInbox.bots")));
  const content = node("div", "");
  panel.append(content);
  const endpoint = "rooms/" + room.id + "/bots";
  let expiryTimer;
  async function render() {
    clearTimeout(expiryTimer);
    const { bots, round } = await api(endpoint);
    if (!panel.open || !panel.isConnected) return;
    if (round)
      expiryTimer = setTimeout(
        () => {
          if (panel.open && panel.isConnected)
            void render().catch(() =>
              status(t("personalInbox.unavailable"), true),
            );
        },
        Math.max(1000, round.expires - Date.now() + 1000),
      );
    const children = [];
    for (const bot of bots) {
      const row = node(
        "div",
        t("personalInbox.botOwner", { bot: bot.name, owner: bot.owner }),
      );
      if (manager)
        row.append(
          button(t("personalInbox.removeBot"), async () => {
            await api(endpoint, { action: "remove", bot: bot.id });
            await refresh();
          }),
        );
      children.push(row);
    }
    if (writable && bots.length >= 2) children.push(node("small", t("personalInbox.botTalkHelp")));
    if (round?.step === -1)
      children.push(node("p", t("personalInbox.botFailed")));
    if (round && round.step !== -1) {
      children.push(
        node("p", t("personalInbox.botWaiting") + (round.topic ? " · " + round.topic : "")),
      );
      if (manager || me.id === round.starter)
        children.push(
          button(t("personalInbox.botCancel"), async () => {
            await api(endpoint, { action: "stop", round: round.id });
            await refresh();
          }),
        );
    } else if (writable && bots.length >= 2) {
      const form = node("form", "");

      const choices = [0, 1].map((position) => {
        const { wrapper, select } = inboxSelect();
        select.setAttribute(
          "aria-label",
          t("personalInbox.bots") + " " + (position + 1),
        );
        for (const b of bots)
          select.add(
            new Option(
              t("personalInbox.botOwner", { bot: b.name, owner: b.owner }),
              b.id,
            ),
          );
        select.selectedIndex = position;
        form.append(wrapper);
        return select;
      });
      const topic = node("textarea", "");
      topic.setAttribute("aria-label", t("personalInbox.botTopic"));
      topic.placeholder = t("personalInbox.botTopic");
      topic.required = true;
      topic.maxLength = 1800;
      const start = node("button", t("personalInbox.botStart"));
      form.append(topic, start);
      form.onchange = () => {
        start.disabled = choices[0].value === choices[1].value;
      };
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (start.disabled || !topic.value.trim()) return;
        start.disabled = true;
        try {
          await api(endpoint, {
            action: "start",
            round: crypto.randomUUID(),
            first: choices[0].value,
            second: choices[1].value,
            topic: topic.value.trim(),
            locale: language,
          });
          await refresh();
        } catch {
          status(t("personalInbox.unavailable"), true);
        } finally {
          start.disabled = false;
        }
      };
      children.push(form);
    }
    content.replaceChildren(...children);
  }
  panel.ontoggle = () => {
    if (panel.open)
      void render().catch(() => status(t("personalInbox.unavailable"), true));
  };
  return panel;
}
