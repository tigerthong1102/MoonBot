const el = (id) => document.getElementById(id);
el("desktop-back").hidden = new URLSearchParams(location.search).get("desktop") !== "1";
for (const back of document.querySelectorAll(".list-back")) {
  back.onclick = () => { delete document.body.dataset.thread; };
}
const accountOnly = !el("desktop-back").hidden && new URLSearchParams(location.search).get("account") === "1";
if (accountOnly) {
  document.title = "Tài khoản StartupBot";
  document.querySelector("header strong").textContent = document.title;
}
const node = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
const status = (text) => {
  el("status").textContent = text;
};
let me,
  rooms = [],
  current = null,
  revision = 0,
  loginEmail = "",
  pendingPost,
  pendingCreate,
  pendingFile;
let posts = [],
  viewingSaved = false,
  readingOlder = false;

function fail(error) {
  const errors = {
    upload_unavailable: "Tệp chưa được gửi. Kiểm tra quyền và giới hạn 20 tệp mỗi ngày.",
    invalid_filename: "Tên tệp không hợp lệ.",
    empty_file: "Tệp trống.",
    request_too_large: "Tệp vượt quá 1 MiB.",
    rate_limited: "Bạn đã thao tác nhiều lần. Vui lòng thử lại sau.",
    room_limit_or_conflict:
      "Đã đạt giới hạn 100 cuộc trò chuyện do bạn tạo hoặc yêu cầu tạo không còn hợp lệ.",
    unavailable: "Nội dung hoặc thao tác này hiện không khả dụng.",
    auth_failed: "Mã không hợp lệ hoặc đã hết hạn.",
    contains_secret: "Nội dung có dấu hiệu chứa khóa truy cập. Hãy bỏ khóa trước khi gửi.",
    unauthorized: "Vui lòng đăng nhập.",
    invalid_request: "Kiểm tra lại nội dung đã nhập.",
  };
  status(errors[error.message] || "Chưa hoàn tất. Kiểm tra kết nối và thử lại.");
}
async function api(path, data) {
  const res = await fetch(
    "/api/" + path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-inbox-language": el("mail-lang").value },
          body: JSON.stringify(data),
        },
  );
  const result = await res.json();
  if (res.status === 401 && result.error === "unauthorized") signedOut();
  if (!res.ok) throw Error(result.error);
  return result;
}
function run(action) {
  return (event) => {
    event?.preventDefault();
    Promise.resolve().then(action).catch(fail);
  };
}
function button(text, action) {
  const b = node("button", text);
  b.type = "button";
  b.onclick = run(async () => {
    b.disabled = true;
    try {
      await action();
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
function clearRoom() {
  revision++;
  current = null;
  delete document.body.dataset.thread;
  el("room-options").open = false;
  el("attach").open = false;
  posts = [];
  pendingPost = null;
  pendingFile = null;
  el("send-file").reset();
  readingOlder = false;
  if (el("preview").open) el("preview").close();
  el("compose").reset();
  composeLabels();
  el("invite").reset();
  el("actions").replaceChildren();
  el("title").textContent = "Chọn cuộc trò chuyện";
  el("conversation").hidden = true;
  for (const id of ["members", "posts", "preview-body", "audience"]) el(id).replaceChildren();
}
function signedOut() {
  me = null;
  rooms = [];
  pendingCreate = null;
  viewingSaved = false;
  clearRoom();
  for (const id of ["rooms", "saved-list", "blocked-list", "account"]) el(id).replaceChildren();
  for (const id of ["inbox", "logout", "saved"]) el(id).hidden = true;
  el("blocked").open = false;
  el("room").hidden = false;
  el("signin").hidden = false;
  el("verify").hidden = true;
  el("verify").reset();
  el("create-room").reset();
  createLabels();
}
el("send-code").onsubmit = run(async () => {
  const form = el("send-code"),
    field = form.elements.email,
    email = field.value.trim(),
    button = form.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  field.readOnly = true;
  try {
    await api("auth/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
  } catch (error) {
    button.disabled = false;
    throw error;
  } finally {
    field.readOnly = false;
  }
  loginEmail = email;
  el("verify").hidden = false;
  el("verify").elements.otp.focus();
  status(
    "Kiểm tra thư mới nhất của " +
      email +
      ", kể cả Thư rác. Mã có hiệu lực 10 phút. Mỗi địa chỉ được yêu cầu tối đa 3 mã trong 15 phút.",
  );
  button.textContent = "Có thể gửi lại sau 1 phút";
  setTimeout(() => {
    button.textContent = "Gửi mã đăng nhập";
    button.disabled = false;
  }, 60_000);
});
el("verify").onsubmit = run(async () => {
  await api("auth/sign-in/email-otp", { email: loginEmail, otp: el("verify").elements.otp.value });
  await start();
});
el("logout").onclick = run(async () => {
  await api("auth/sign-out", {});
  signedOut();
  status("Đã đăng xuất.");
});
async function start() {
  me = await api("me");
  el("account").textContent = me.email;
  el("signin").hidden = true;
  if (accountOnly) {
    location.assign("/desktop/back");
    return;
  }
  el("inbox").hidden = false;
  el("logout").hidden = false;
  status("");
  await refresh();
}
function roomName(r) {
  return r.kind === "direct" && !r.isOwner ? r.inviter : r.title;
}
async function refresh() {
  const version = ++revision,
    result = await api("rooms");
  if (version !== revision || !me) return;
  rooms = result.rooms;
  el("rooms").replaceChildren(
    ...rooms.map((r) => {
      const title = (r.state === "pending" ? "Lời mời · " : "") + roomName(r);
      const b = button(title, () => select(r.id));
      const avatar = node("span", roomName(r).trim().slice(0, 1).toLocaleUpperCase("vi"));
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");
      const text = node("span", title);
      text.className = "room-name";
      text.append(node("small", r.kind === "group" ? "Nhóm" : "Trò chuyện riêng"));
      b.setAttribute("aria-label", title);
      b.replaceChildren(avatar, text);
      b.setAttribute("aria-current", String(r.id === current && !viewingSaved));
      return b;
    }),
  );
  if (!rooms.length) el("rooms").append(node("p", "Chưa có cuộc trò chuyện."));
  if (viewingSaved || !current) return;
  const r = rooms.find((x) => x.id === current);
  if (!r) {
    clearRoom();
    return;
  }
  el("title").textContent = roomName(r);
  el("actions").replaceChildren();
  el("manage").replaceChildren();
  const act = (text, route, message) =>
    button(text, async () => {
      await api("rooms/" + r.id + "/" + route, {});
      status(message);
      await refresh();
    });
  if (r.state === "pending") {
    el("conversation").hidden = true;
    el("actions").append(
      node("p", "Lời mời từ " + r.inviter + " · Bạn chỉ thấy tin mới sau khi tham gia."),
      act("Tham gia", "accept", "Đã tham gia."),
      act("Từ chối", "leave", "Đã từ chối."),
      act("Chặn lời mời từ người này", "block", "Đã chặn người mời."),
    );
    return;
  }
  let detail;
  try {
    detail = await api("rooms/" + r.id);
  } catch (err) {
    if (version === revision) clearRoom();
    throw err;
  }
  if (version !== revision) return;
  el("conversation").hidden = false;
  el("invite").hidden = !(r.kind === "group" && r.isOwner);
  el("members").replaceChildren(
    ...detail.members.map((m) => {
      const li = node("li", m.email);
      if (r.isOwner && r.kind === "group" && m.id !== me.id)
        li.append(
          button("Xóa khỏi nhóm", async () => {
            await api("rooms/" + r.id + "/remove", { person: m.id });
            await refresh();
          }),
        );
      return li;
    }),
  );
  if (r.isOwner && r.kind === "direct" && detail.members.length === 2)
    el("manage").append(act("Chặn người này", "block", "Đã chặn."));
  if (r.isOwner)
    el("manage").append(
      button("Đóng cuộc trò chuyện", async () => {
        if (!window.confirm("Đóng cuộc trò chuyện và xóa lịch sử chung cho tất cả thành viên?")) return;
        await api("rooms/" + r.id + "/close", {});
        clearRoom();
        await refresh();
      }),
    );
  else
    el("manage").append(
      act("Rời cuộc trò chuyện", "leave", "Đã rời cuộc trò chuyện."),
      act("Rời và chặn lời mời của chủ phòng", "block", "Đã rời và chặn người mời."),
    );
  const waiting = r.kind === "direct" && detail.members.length !== 2;
  el("compose").hidden = waiting;
  el("send-file").hidden = waiting;
  el("attach").hidden = waiting;
  if (readingOlder)
    el("actions").append(
      button("Về tin mới nhất", async () => {
        readingOlder = false;
        await refresh();
      }),
    );
  if (!readingOlder) {
    const previous = posts.at(-1)?.seq;
    const history = el("history");
    const latestVisible = history.scrollHeight - history.scrollTop - history.clientHeight < 70;
    posts = detail.posts;
    el("older").hidden = !detail.more;
    renderPosts();
    if (previous !== posts.at(-1)?.seq && (!previous || latestVisible || posts.at(-1)?.author === me.email)) {
      history.scrollTop = history.scrollHeight;
    }
  }
  if (waiting) el("posts").replaceChildren(node("li", "Chỉ gửi tin khi cả hai đã tham gia."));
}
async function select(id) {
  if (current !== id || viewingSaved) clearRoom();
  current = id;
  document.body.dataset.thread = "open";
  el("new-room").open = false;
  viewingSaved = false;
  el("room").hidden = false;
  el("saved").hidden = true;
  status("");
  await refresh();
}
function createLabels() {
  const form = el("create-room"),
    group = form.elements.kind.value === "group";
  form.querySelector("fieldset").hidden = group;
  el("target-label").textContent = group ? "Tên nhóm" : "Email người nhận";
  form.elements.target.type = group ? "text" : "email";
  form.elements.target.maxLength = group ? 80 : 254;
}
el("create-room").elements.kind.onchange = createLabels;
el("create-room").onsubmit = run(async () => {
  const form = el("create-room"),
    kind = form.elements.kind.value,
    target = form.elements.target.value.trim();
  const guest = { locale: form.elements.locale.value, note: form.elements.note.value.trim() };
  const key = JSON.stringify([kind, target, guest]);
  if (pendingCreate?.key !== key) pendingCreate = { key, id: crypto.randomUUID() };
  const { id } = await api("rooms", {
    kind,
    id: pendingCreate.id,
    ...(kind === "group" ? { title: target } : { email: target, guest }),
  });
  pendingCreate = null;
  form.reset();
  createLabels();
  await select(id);
});
el("invite").onsubmit = run(async () => {
  const form = el("invite");
  await api("rooms/" + current + "/invite", {
    email: form.elements.email.value.trim(),
    guest: { locale: form.elements.locale.value, note: form.elements.note.value.trim() },
  });
  el("invite").reset();
  status("Đã ghi nhận yêu cầu mời. Người nhận đủ điều kiện sẽ thấy lời mời trong hộp thư.");
});
function composeLabels() {
  const kind = el("compose").elements.kind.value;
  el("draft-label").textContent = {
    text: "Tin nhắn",
    skill: "Nội dung SKILL.md",
    task: "Yêu cầu và tiêu chí hoàn thành",
  }[kind];
  el("submit-post").textContent = kind === "text" ? "Gửi" : "Xem lại trước khi gửi";
}
el("compose").elements.kind.onchange = composeLabels;
el("draft").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && el("compose").elements.kind.value === "text") {
    event.preventDefault();
    el("compose").requestSubmit();
  }
};
async function send(p) {
  await api("rooms/" + p.room + "/posts", { nonce: p.nonce, kind: p.kind, body: p.body });
  if (current !== p.room || pendingPost !== p) return;
  pendingPost = null;
  el("compose").reset();
  composeLabels();
  readingOlder = false;
  if (el("preview").open) el("preview").close();
  await refresh();
}
el("compose").onsubmit = run(async () => {
  const form = el("compose"),
    kind = form.elements.kind.value,
    body = form.elements.body.value.trim();
  if (!body) return;
  if (!pendingPost || pendingPost.room !== current || pendingPost.kind !== kind || pendingPost.body !== body)
    pendingPost = { room: current, kind, body, nonce: crypto.randomUUID() };
  if (kind === "text") return send(pendingPost);
  el("audience").textContent = "Gửi vào " + el("title").textContent + ". Thành viên có thể lưu bản sao.";
  el("preview-body").textContent = body;
  el("preview").showModal();
});
el("cancel-share").onclick = () => el("preview").close();
el("confirm-share").onclick = run(() => send(pendingPost));
function renderPosts() {
  el("posts").replaceChildren(
    ...posts.map((p) => {
      const li = document.createElement("li"),
        label = { skill: " · Skill", task: " · Công việc", text: "", file: " · Tệp" }[p.kind];
      li.classList.toggle("mine", p.author === me.email);
      li.append(
        node("small", p.author + label + " · " + new Date(p.created).toLocaleString("vi-VN")),
        node("pre", p.body),
      );
      if (p.kind === "file") {
        const link = node("a", "Tải tệp");
        link.href = "/api/rooms/" + current + "/files/" + p.seq;
        link.download = p.body;
        li.append(link);
      } else if (p.kind !== "text")
        li.append(
          button(p.kind === "skill" ? "Lưu bản sao skill" : "Nhận việc", async () => {
            await api("saved", { seq: p.seq, action: "save" });
            status("Đã lưu vào mục Skill và việc đã nhận của bạn.");
          }),
        );
      return li;
    }),
  );
  if (!posts.length) el("posts").append(node("li", "Chưa có tin nhắn."));
}
el("send-file").onsubmit = run(async () => {
  const form = el("send-file"),
    file = form.elements.file.files[0],
    room = current;
  if (!file || !file.size) throw Error("empty_file");
  if (file.size > 1048576) throw Error("request_too_large");
  if (file !== pendingFile?.file || room !== pendingFile.room)
    pendingFile = { file, room, nonce: crypto.randomUUID() };
  const res = await fetch("/api/rooms/" + room + "/files/" + pendingFile.nonce, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-inbox-name": encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) {
    if (res.status === 401) signedOut();
    throw Error((await res.json()).error);
  }
  if (room === current && pendingFile?.file === file) {
    form.reset();
    pendingFile = null;
    await refresh();
  }
});
el("older").onclick = run(async () => {
  if (!posts.length) return;
  const id = current,
    first = posts[0].seq;
  const page = await api("rooms/" + id + "?before=" + first);
  if (current !== id || posts[0]?.seq !== first) return;
  readingOlder = true;
  posts = [...page.posts, ...posts];
  renderPosts();
  el("older").hidden = !page.more;
  await refresh();
});
async function showSaved() {
  clearRoom();
  viewingSaved = true;
  document.body.dataset.thread = "open";
  el("room").hidden = true;
  el("saved").hidden = false;
  const version = revision,
    { saved } = await api("saved");
  if (!viewingSaved || !me || version !== revision) return;
  el("saved-list").replaceChildren(
    ...saved.map((p) => {
      const item = document.createElement("article");
      item.append(
        node("small", p.kind === "skill" ? "Skill" : p.done ? "Việc đã hoàn thành" : "Việc đã nhận"),
        node("pre", p.body),
      );
      if (p.kind === "skill")
        item.append(
          button("Tải SKILL.md", () => {
            const link = document.createElement("a");
            link.download = "SKILL.md";
            link.href = URL.createObjectURL(new Blob([p.body], { type: "text/plain;charset=utf-8" }));
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          }),
        );
      if (p.kind === "task" && !p.done)
        item.append(
          button("Hoàn thành", async () => {
            await api("saved", { seq: p.seq, action: "done" });
            await showSaved();
          }),
        );
      item.append(
        button("Xóa bản sao", async () => {
          await api("saved", { seq: p.seq, action: "delete" });
          await showSaved();
        }),
      );
      return item;
    }),
  );
  if (!saved.length) el("saved-list").append(node("p", "Chưa có skill hoặc việc đã nhận."));
}
el("open-saved").onclick = run(showSaved);
async function showBlocked() {
  const { people } = await api("blocks");
  el("blocked-list").replaceChildren(
    ...people.map((p) => {
      const li = node("li", p.email);
      li.append(
        button("Bỏ chặn", async () => {
          await api("blocks", { person: p.id });
          await showBlocked();
        }),
      );
      return li;
    }),
  );
  if (!people.length) el("blocked-list").append(node("li", "Chưa chặn ai."));
}
el("blocked").ontoggle = run(async () => {
  if (el("blocked").open && me) await showBlocked();
});

setInterval(() => {
  if (me && !viewingSaved && !document.hidden) refresh().catch(fail);
}, 5000);
el("mail-lang").value = (new URLSearchParams(location.search).get("lang") ?? navigator.language).startsWith(
  "vi",
)
  ? "vi"
  : "en";
const stopParams = new URLSearchParams(location.hash.slice(1));
if (stopParams.has("stop")) {
  const token = stopParams.get("stop"),
    en = stopParams.get("lang") === "en";
  history.replaceState(null, "", location.pathname);
  el("stop-mail").hidden = false;
  el("stop-button").textContent = en ? "Stop invitation emails" : "Dừng nhận email mời";
  el("stop-button").onclick = run(async () => {
    await api("stop-invitations", { token });
    el("stop-button").hidden = true;
    el("stop-result").textContent = en ? "Invitation emails have been stopped." : "Đã dừng nhận email mời.";
  });
} else
  start().catch((e) => {
    if (e.message !== "unauthorized") fail(e);
  });
