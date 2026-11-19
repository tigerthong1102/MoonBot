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
    const role = isOwner ? "Chủ nhóm" : m.admin ? "Quản trị viên" : "Thành viên";
    const li = node("li", m.email + " · " + role + (m.muted ? " · Chỉ xem" : ""));
    if (manager && m.id !== me.id && !isOwner && (owner || !m.admin)) {
      const menu = node("details", "");
      menu.append(node("summary", "Quản lý " + m.email));
      const fields = { person: m.id };
      if (owner) {
        menu.append(
          actionButton(m.admin ? "Thu hồi quyền admin" : "Đặt làm admin", m.admin ? "demote" : "promote", fields),
        );
        menu.append(
          actionButton("Chuyển quyền chủ nhóm", "transfer", fields, "Chuyển quyền chủ nhóm cho " + m.email + "?"),
        );
      }
      if (!m.admin)
        menu.append(
          actionButton(m.muted ? "Cho phép gửi lại" : "Hạn chế gửi", m.muted ? "unmute" : "mute", fields),
        );
      menu.append(
        actionButton("Xóa khỏi nhóm", "remove", fields, "Xóa " + m.email + " khỏi nhóm?"),
        actionButton("Cấm vào nhóm", "ban", fields, "Cấm " + m.email + " tham gia lại cho đến khi được gỡ cấm?"),
      );
      li.append(menu);
    }
    list.append(li);
  }
  const controls = document.createDocumentFragment();
  if (detail.group.link || manager) {
    controls.append(
      button("Sao chép liên kết mời", async () => {
        const token = manager
          ? (await api("rooms/" + room.id + "/moderate", { action: "ensureLink" })).token
          : detail.group.link;
        const address = new URL("/", location.origin);
        address.hash = "join=" + token;
        try {
          await navigator.clipboard.writeText(address.href);
          status("Đã sao chép liên kết mời.");
        } catch {
          const field = document.getElementById("invite-link-field");
          field.value = address.href;
          field.hidden = false;
          field.focus();
          field.select();
          status("Sao chép liên kết đang được chọn.");
        }
      }),
    );
  }
  if (manager) {
    const menu = node("details", "");
    menu.append(node("summary", "Quyền và cài đặt nhóm"));
    const rename = document.createElement("form"),
      input = document.createElement("input");
    input.required = true;
    input.maxLength = 80;
    input.value = room.title;
    input.setAttribute("aria-label", "Tên nhóm mới");
    const submit = node("button", "Đổi tên nhóm");
    rename.append(input, submit);
    rename.onsubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await run("rename", { title: input.value.trim() });
      } catch {
        status("Chưa đổi được tên nhóm.", true);
      } finally {
        submit.disabled = false;
      }
    };
    menu.append(rename);
    for (const [key, label, on] of [
      ["approval", "Duyệt người vào từ liên kết", detail.group.approval],
      ["announcements", "Chỉ quản trị viên được gửi", detail.group.announcements],
    ]) {
      const control = actionButton(label, key, { enabled: !on });
      control.setAttribute("role", "switch");
      control.setAttribute("aria-checked", String(!!on));
      control.append(on ? " · Bật" : " · Tắt");
      menu.append(control);
    }
    menu.append(
      actionButton(
        detail.group.link ? "Đổi liên kết mời" : "Tạo liên kết mời 7 ngày",
        "newLink",
        {},
        detail.group.link ? "Thay liên kết và hủy các yêu cầu đang chờ từ liên kết cũ?" : null,
      ),
    );
    if (detail.group.link)
      menu.append(
        actionButton("Thu hồi liên kết mời", "revokeLink", {}, "Thu hồi liên kết và hủy yêu cầu đang chờ?"),
      );
    controls.append(menu);
    for (const [people, label, actions] of [
      [
        detail.requests,
        "Đang chờ duyệt",
        [
          ["Duyệt", "approve"],
          ["Từ chối", "deny"],
          ["Cấm vào nhóm", "ban"],
        ],
      ],
      [detail.bans, "Đã cấm", [["Gỡ cấm", "unban"]]],
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
              action === "ban" ? "Cấm " + p.email + " tham gia nhóm?" : null,
            ),
          );
        controls.append(row);
      }
    }
  }
  return { list, controls };
}
