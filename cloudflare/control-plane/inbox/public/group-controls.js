import { t } from "./inbox-i18n.js";
export function groupControls({ room, detail, me, node, button, api, refresh, status }) {
  const owner = !!room.isOwner,
    manager = owner || !!room.admin;
  const run = async (action, fields = {}) => {
    await api("rooms/" + room.id + "/moderate", { action, ...fields });
    await refresh();
  };
  const actionButton = (label, action, fields, confirmText) =>
    button(label, async () => {
      if (!confirmText || window.confirm(confirmText)) await run(action, fields);
    });
  const list = document.createDocumentFragment();
  for (const m of detail.members) {
    const isOwner = m.id === detail.group.owner;
    const role = isOwner ? t("personalInbox.owner") : m.admin ? t("personalInbox.admin") : t("personalInbox.member");
    const li = node("li", m.email + " · " + role + (m.muted ? t("personalInbox.mutedSuffix") : ""));
    if (manager && m.id !== me.id && !isOwner && (owner || !m.admin)) {
      const menu = node("details", "");
      menu.append(node("summary", t("personalInbox.managePerson", { email: m.email })));
      const fields = { person: m.id };
      if (owner) {
        menu.append(
          actionButton(m.admin ? t("personalInbox.demote") : t("personalInbox.promote"), m.admin ? "demote" : "promote", fields),
        );
        menu.append(
          actionButton(t("personalInbox.transfer"), "transfer", fields, t("personalInbox.confirmTransfer", { email: m.email })),
        );
      }
      if (!m.admin)
        menu.append(
          actionButton(m.muted ? t("personalInbox.unmute") : t("personalInbox.mute"), m.muted ? "unmute" : "mute", fields),
        );
      menu.append(
        actionButton(t("personalInbox.removeMember"), "remove", fields, t("personalInbox.confirmRemove", { email: m.email })),
        actionButton(t("personalInbox.ban"), "ban", fields, t("personalInbox.confirmBan", { email: m.email })),
      );
      li.append(menu);
    }
    list.append(li);
  }
  const controls = document.createDocumentFragment();
  if (detail.group.link || manager) {
    controls.append(
      button(t("personalInbox.copyLink"), async () => {
        const token = manager
          ? (await api("rooms/" + room.id + "/moderate", { action: "ensureLink" })).token
          : detail.group.link;
        const address = new URL("/", location.origin);
        address.hash = "join=" + token;
        try {
          await navigator.clipboard.writeText(address.href);
          status(t("personalInbox.copied"));
        } catch {
          const field = document.getElementById("invite-link-field");
          field.value = address.href;
          field.hidden = false;
          field.focus();
          field.select();
          status(t("personalInbox.copySelected"));
        }
      }),
    );
  }
  if (manager) {
    const menu = node("details", "");
    menu.append(node("summary", t("personalInbox.permissions")));
    const rename = document.createElement("form"),
      input = document.createElement("input");
    input.required = true;
    input.maxLength = 80;
    input.value = room.title;
    input.setAttribute("aria-label", t("personalInbox.newName"));
    const submit = node("button", t("personalInbox.rename"));
    rename.append(input, submit);
    rename.onsubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await run("rename", { title: input.value.trim() });
      } catch {
        status(t("personalInbox.renameFailed"), true);
      } finally {
        submit.disabled = false;
      }
    };
    menu.append(rename);
    for (const [key, label, on] of [
      ["approval", t("personalInbox.requireApproval"), detail.group.approval],
      ["announcements", t("personalInbox.announcementMode"), detail.group.announcements],
    ]) {
      const control = actionButton(label, key, { enabled: !on });
      control.setAttribute("role", "switch");
      control.setAttribute("aria-checked", String(!!on));
      control.append(on ? t("personalInbox.onSuffix") : t("personalInbox.offSuffix"));
      menu.append(control);
    }
    menu.append(
      actionButton(
        detail.group.link ? t("personalInbox.rotate") : t("personalInbox.newLink"),
        "newLink",
        {},
        detail.group.link ? t("personalInbox.confirmRotate") : null,
      ),
    );
    if (detail.group.link)
      menu.append(
        actionButton(t("personalInbox.revoke"), "revokeLink", {}, t("personalInbox.confirmRevoke")),
      );
    controls.append(menu);
    for (const [people, label, actions] of [
      [
        detail.requests,
        t("personalInbox.pending"),
        [
          [t("personalInbox.approve"), "approve"],
          [t("personalInbox.decline"), "deny"],
          [t("personalInbox.ban"), "ban"],
        ],
      ],
      [detail.bans, t("personalInbox.banned"), [[t("personalInbox.unban"), "unban"]]],
    ]) {
      if (people.length) controls.append(node("h4", label));
      for (const p of people) {
        const row = node("div", p.email);
        for (const [text, action] of actions)
          row.append(
            actionButton(
              text,
              action,
              { person: p.id },
              action === "ban" ? t("personalInbox.banApplicant", { email: p.email }) : null,
            ),
          );
        controls.append(row);
      }
    }
  }
  return { list, controls };
}
