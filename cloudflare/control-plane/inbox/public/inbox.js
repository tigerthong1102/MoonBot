import { groupControls } from "./group-controls.js";
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
const entry = new URLSearchParams(location.hash.slice(1));
let joinToken = entry.get("join"), invitedRoom = entry.get("room"), moderators = new Set();
let statusTimer;
const status = (text, persistent = false) => {
  clearTimeout(statusTimer);
  el("status").textContent = text;
  if (text && !persistent) statusTimer = setTimeout(() => { el("status").textContent = ""; }, 4500);
};
let me,
  rooms = [],
  current = null,
  revision = 0,
  loginEmail = "",
  pendingPost,
  pendingCreate,
  markdownShare,
  activeBatch,
  attachments = [];
let posts = [],
  viewingSaved = false,
  readingOlder = false;

function fail(error) {
  const errors = {
    upload_unavailable: "Tệp chưa được gửi. Kiểm tra quyền gửi hoặc dung lượng còn lại (20 tệp, 60 MB mỗi 24 giờ; kho thử nghiệm 180 MB).",
    invalid_filename: "Tên tệp không hợp lệ.",
    empty_file: "Tệp trống.",
    skill_file_text: "Chế độ skill cần tệp Markdown có nội dung văn bản UTF-8. Bạn vẫn có thể gửi nguyên tệp.",
    skill_file_length: "Nội dung vượt giới hạn tin skill. Bạn có thể gửi nguyên tệp Markdown.",
    request_too_large: me ? "Tệp vượt quá " + fileSize(me.maxFileBytes) + "." : "Tệp quá lớn.",
    rate_limited: "Bạn đã thao tác nhiều lần. Vui lòng thử lại sau.",
    room_limit_or_conflict:
      "Đã đạt giới hạn 100 cuộc trò chuyện do bạn tạo hoặc yêu cầu tạo không còn hợp lệ.",
    unavailable: "Nội dung hoặc thao tác này hiện không khả dụng.",
    auth_failed: "Mã không hợp lệ hoặc đã hết hạn.",
    contains_secret: "Nội dung có dấu hiệu chứa khóa truy cập. Hãy bỏ khóa trước khi gửi.",
    unauthorized: "Vui lòng đăng nhập.",
    invalid_request: "Kiểm tra lại nội dung đã nhập.",
  };
  status(errors[error.message] || "Chưa hoàn tất. Kiểm tra kết nối và thử lại.", true);
}
async function api(path, data) {
  const res = await fetch(
    "/api/" + path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-inbox-language": el("mail-lang").value, ...(joinToken && path.startsWith("auth/") ? {"x-inbox-invite":joinToken} : {}) },
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
let lastDetailAt = 0;
let lastActivity = 0;
let refreshes = 0;
function clearRoom() {
  lastDetailAt = 0;
  revision++;
  current = null;
  delete document.body.dataset.thread;
  el("quick-invite").hidden = true;
  el("room-options").open = false;
  activeBatch = null;
  markdownShare = null;
  for (const item of attachments) if (item.preview) URL.revokeObjectURL(item.preview);
  attachments = [];
  renderAttachments();
  posts = [];
  pendingPost = null;
  readingOlder = false;
  if (el("preview").open) el("preview").close();
  el("compose").reset();
  composeLabels();
  el("invite").reset();
  el("actions").replaceChildren();
  el("empty-room").hidden = false;
  document.querySelector(".room-heading").hidden = true;
  el("conversation").hidden = true;
  for (const id of ["members", "posts", "preview-body", "audience"]) el(id).replaceChildren();
}
function signedOut() {
  disconnectSignals();
  me = null;
  rooms = [];
  el("filter").value = "";
  pendingCreate = null;
  viewingSaved = false;
  clearRoom();
  for (const id of ["rooms", "saved-list", "blocked-list", "account"]) el(id).replaceChildren();
  for (const id of ["inbox", "logout", "saved"]) el(id).hidden = true;
  el("blocked").open = false;
  el("room").hidden = false;
  el("signin").hidden = false;
  el("join-prompt").hidden = true;
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
  el("attach").title = "Đính kèm tệp (tối đa " + fileSize(me.maxFileBytes) + " mỗi tệp)";
  el("signin").hidden = true;
  if (accountOnly) {
    location.assign("/desktop/back");
    return;
  }
  el("inbox").hidden = false;
  el("logout").hidden = false;
  status("");
  await refresh();
  if (invitedRoom && rooms.some(r => r.id === invitedRoom)) {
    await select(invitedRoom); invitedRoom = null; history.replaceState(null,"",location.pathname + location.search);
  }
  if (joinToken) await showGroupInvitation();
  connectSignals();
}
async function showGroupInvitation() {
  try {
    const info = await api("join/preview",{token:joinToken});
    el("join-title").textContent = "Lời mời vào nhóm " + info.title;
    el("join-button").textContent = info.approval ? "Yêu cầu tham gia" : "Tham gia nhóm";
    el("join-button").hidden = !me;
    el("join-prompt").hidden = false;
  } catch { status("Liên kết mời đã hết hạn hoặc không còn hiệu lực.",true); }
}
el("join-button").onclick = run(async () => {
  const response = await api("join",{token:joinToken});
  joinToken = null; history.replaceState(null,"",location.pathname + location.search); el("join-prompt").hidden = true;
  if (response.state === "requested") status("Đã gửi yêu cầu. Nhóm sẽ hiện trong danh sách khi được duyệt.",true);
  else await select(response.id);
});
function roomName(r) {
  return r.kind === "direct" && !r.isOwner ? r.inviter : r.title;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "#i-" + name);
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}
function avatarContent(room) {
  return room.kind === "group" ? icon("group") : roomName(room).trim().slice(0, 1).toLocaleUpperCase("vi");
}
function renderRooms() {
  const query = el("filter").value.trim().toLocaleLowerCase("vi");
  const visible = rooms.filter((room) => roomName(room).toLocaleLowerCase("vi").includes(query));
  el("rooms").replaceChildren(...visible.map((r) => {
    const name = roomName(r);
    const title = (r.state === "pending" ? "Lời mời · " : "") + name;
    const row = button(title, () => select(r.id));
    const avatar = node("span", "");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.append(avatarContent(r));
    const text = node("span", "");
    text.className = "room-name";
    text.append(node("strong", name), node("small", r.state === "pending" ? "Lời mời trò chuyện" :
      r.snippet || (r.kind === "group" ? "Chat nhóm" : "Chat riêng")));
    row.setAttribute("aria-label", title);
    row.title = title;
    row.setAttribute("aria-current", String(r.id === current && !viewingSaved));
    row.replaceChildren(avatar, text);
    return row;
  }));
  if (!visible.length) el("rooms").append(node("p", query ? "Không tìm thấy cuộc trò chuyện." : "Chưa có cuộc trò chuyện."));
}
el("filter").oninput = renderRooms;
async function refresh(poll = false) {
  refreshes++;
  try {
    await refreshRoom(poll);
  } finally {
    refreshes--;
  }
}
async function refreshRoom(poll) {
  const version = ++revision;
  const params = new URLSearchParams();
  if (current && !viewingSaved) {
    params.set("open", current);
    if (poll && !readingOlder && lastDetailAt && performance.now() - lastDetailAt < 5000)
      { params.set("latest", String(posts.at(-1)?.seq ?? 0)); params.set("revision",String(rooms.find(r=>r.id===current)?.revision)); }
  }
  const result = await api("rooms" + (params.size ? "?" + params : ""));
  if (version !== revision || !me) return;
  const previousRoom = rooms.find((room) => room.id === current);
  rooms = result.rooms;
  renderRooms();
  if (viewingSaved || !current) return;
  const r = rooms.find((x) => x.id === current);
  if (!r) {
    clearRoom();
    return;
  }
  if (previousRoom?.state === "active" && previousRoom.afterSeq !== r.afterSeq) {
    clearRoom();
    await select(r.id);
    return;
  }
  if (r.state === "active" && result.unchanged) return;
  if (r.state === "active" && result.detail === null) {
    clearRoom();
    return;
  }
  el("empty-room").hidden = true;
  document.querySelector(".room-heading").hidden = false;
  el("room-avatar").replaceChildren(avatarContent(r));
  el("title").textContent = roomName(r);
  el("title").title = roomName(r);
  el("room-meta").textContent = r.state === "pending" ? "Lời mời trò chuyện" : r.kind === "group" ? "Chat nhóm" : "Chat riêng";
  el("actions").replaceChildren();
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
    detail = result.detail ?? await api("rooms/" + r.id);
  } catch (err) {
    if (version === revision) clearRoom();
    throw err;
  }
  if (version !== revision) return;
  lastDetailAt = performance.now();
  el("conversation").hidden = false;
  const group = r.kind === "group";
  const manager = group && (r.isOwner || r.admin);
  el("invite").hidden = !manager;
  el("quick-invite").hidden = !(group && (manager || detail.group.link));
  el("quick-invite").textContent = manager ? "Mời vào nhóm" : "Chia sẻ liên kết mời";
  moderators = new Set(detail.members.filter(m => m.admin || m.id === detail.group.owner).map(m => m.email));
  const oldRevision = previousRoom?.revision;
  if (group && oldRevision !== r.revision) readingOlder = false;
  const panel = el("room-options");
  if (!poll || panel.dataset.room !== r.id || panel.dataset.revision !== String(r.revision)) {
    panel.dataset.room=r.id; panel.dataset.revision=String(r.revision);
    el("manage").replaceChildren();
    if (group) {
      const ui = groupControls({room:r,detail,me,node,button,api,refresh,status});
      el("members").replaceChildren(ui.list); el("manage").append(ui.controls);
    } else el("members").replaceChildren(...detail.members.map(m => node("li", m.email)));
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
  }
  const waiting = r.kind === "direct" && detail.members.length !== 2;
  const limited = group && (r.muted || (r.announcements && !manager));
  el("compose").hidden = !!(waiting || limited);
  el("post-limited").hidden = !limited;
  if (limited) el("post-limited").textContent = r.muted ? "Bạn chỉ có quyền xem trong nhóm này." : "Chỉ quản trị viên được gửi trong nhóm này.";
  if (r.kind === "group") el("room-meta").textContent = detail.members.length + " thành viên";
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
    const changed = oldRevision !== r.revision || !el("posts").childElementCount || previous !== detail.posts.at(-1)?.seq ||
      posts[0]?.seq !== detail.posts[0]?.seq || posts.length !== detail.posts.length;
    posts = detail.posts;
    el("older").hidden = !detail.more;
    if (changed || !posts.length) renderPosts();
    if (changed && posts.length) lastActivity = Date.now();
    if (previous !== posts.at(-1)?.seq && (!previous || latestVisible || posts.at(-1)?.author === me.email)) {
      history.scrollTop = history.scrollHeight;
    }
  }
  if (waiting) el("posts").replaceChildren(node("li", "Chỉ gửi tin khi cả hai đã tham gia."));
}
async function select(id) {
  if (current !== id || viewingSaved) clearRoom();
  current = id;
  lastActivity = Date.now();
  document.body.dataset.thread = "open";
  el("new-room").open = false;
  viewingSaved = false;
  el("room").hidden = false;
  el("saved").hidden = true;
  status("");
  await refresh();
}
el("quick-invite").onclick = () => {
  el("room-options").open = true;
  if (!el("invite").hidden) el("invite").elements.email.focus();
  else el("manage").querySelector("button")?.click();
};
function createLabels() {
  const form = el("create-room"),
    group = form.elements.kind.value === "group";
  form.querySelector("details").hidden = group;
  form.querySelector("button").textContent = group ? "Tạo nhóm" : "Mở trò chuyện";
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
  const action = kind === "text" ? "Gửi" : "Xem lại trước khi gửi";
  el("draft").placeholder = kind === "text" ? "Nhập tin nhắn…" : el("draft-label").textContent;
  el("submit-post").setAttribute("aria-label", action);
  el("submit-post").title = action;
  updateComposer();
}
el("compose").elements.kind.onchange = composeLabels;
el("draft").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && el("compose").elements.kind.value === "text") {
    event.preventDefault();
    el("compose").requestSubmit();
  }
};
async function sendDraft() {
  if (activeBatch) return;
  const room = current;
  const post = pendingPost;
  const batch = { room };
  status("");
  activeBatch = batch;
  renderAttachments();
  try {
    while (attachments.length) {
      const item = attachments[0];
      await uploadFile(room, item);
      if (activeBatch !== batch) return;
      removeAttachment(item);
    }
    if (post) {
      await api("rooms/" + room + "/posts", {nonce:post.nonce, kind:post.kind, body:post.body});
      if (activeBatch !== batch) return;
    }
    pendingPost = null;
    el("compose").reset();
    composeLabels();
    readingOlder = false;
    if (el("preview").open) el("preview").close();
    await refresh();
  } finally {
    if (activeBatch === batch) {
      activeBatch = null;
      renderAttachments();
    }
  }
}
el("compose").onsubmit = run(async () => {
  const form = el("compose"),
    kind = form.elements.kind.value,
    body = form.elements.body.value.trim();
  if (activeBatch || (!body && !attachments.length)) return;
  if (!body) pendingPost = null;
  else if (!pendingPost || pendingPost.room !== current || pendingPost.kind !== kind || pendingPost.body !== body)
    pendingPost = { room: current, kind, body, nonce: crypto.randomUUID() };
  if (kind === "text") return sendDraft();
  el("audience").textContent = "Gửi vào " + el("title").textContent + ". Thành viên có thể lưu bản sao.";
  el("preview-body").textContent = body;
  el("preview").showModal();
});
el("cancel-share").onclick = () => el("preview").close();
el("preview").onclose = () => { markdownShare = null; };
el("confirm-share").onclick = run(async () => {
  const share = markdownShare;
  if (!share) return sendDraft();
  if (activeBatch || current !== share.room || !attachments.includes(share.item)) return;
  activeBatch = share;
  updateComposer();
  try {
    await api("rooms/" + share.room + "/posts", share.post);
    if (activeBatch !== share) return;
    removeAttachment(share.item);
    el("preview").close();
    readingOlder = false;
    await refresh();
  } finally {
    if (activeBatch === share) {
      activeBatch = null;
      renderAttachments();
    }
  }
});
const isMarkdown = (name) => /\.(?:md|markdown)$/i.test(name);
async function previewMarkdown(item) {
  const room = current;
  const limit = el("draft").maxLength;
  if (item.file.size > 4 * limit + 3) throw Error("skill_file_length");
  let body;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(await item.file.arrayBuffer()).trim();
  } catch {
    throw Error("skill_file_text");
  }
  if (!body || body.includes("\0")) throw Error("skill_file_text");
  const post = { kind: "skill", body, nonce: item.skillNonce ??= crypto.randomUUID() };
  if (body.length > limit || new TextEncoder().encode(JSON.stringify(post)).length > 16 * 1024)
    throw Error("skill_file_length");
  if (room !== current || activeBatch || !attachments.includes(item) || el("preview").open) return;
  markdownShare = { room, item, post };
  el("audience").textContent = item.file.name + " · Gửi vào " + el("title").textContent;
  el("preview-body").textContent = body;
  el("preview").showModal();
}
const canPreview = (name) => /\.(?:png|jpe?g|gif|webp)$/i.test(name);
function fileSize(bytes) {
  if (bytes >= 1_000_000) return new Intl.NumberFormat("vi", {maximumFractionDigits: 2}).format(bytes / 1_000_000) + " MB";
  if (bytes < 1024) return bytes + " B";
  return new Intl.NumberFormat("vi", {maximumFractionDigits: 1}).format(bytes / 1024) + " KiB";
}
function fileDetails(name, size) {
  const details = node("span", "");
  details.className = "file-details";
  const type = /^skill\.md$/i.test(name) ? "Skill Markdown" : isMarkdown(name) ? "Markdown" : name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toUpperCase() || "Tệp";
  details.append(node("strong", name), node("small", size == null ? type : type + " · " + fileSize(size)));
  return details;
}
function thumbnail(src) {
  const image = document.createElement("img");
  image.alt = "";
  image.className = "thumbnail";
  image.loading = "lazy";
  image.onerror = () => image.remove();
  image.src = src;
  return image;
}
function attachmentCard(post) {
  const link = document.createElement("a");
  link.href = "/api/rooms/" + current + "/files/" + post.seq;
  link.download = post.body;
  link.className = "file-card";
  link.setAttribute("aria-label", "Tải tệp " + post.body);
  if (canPreview(post.body)) link.append(thumbnail(link.href + "?preview=1"));
  const row = node("span", "");
  row.className = "file-row";
  row.append(icon("file"), fileDetails(post.body, post.fileSize), icon("down"));
  link.append(row);
  return link;
}
function renderPosts() {
  const items = [];
  let lastDay, previous;
  for (const p of posts) {
    const date = new Date(p.created);
    const day = date.toLocaleDateString("vi-VN");
    const grouped = day === lastDay && previous?.author === p.author && p.created - previous.created < 120000;
    if (day !== lastDay) {
      const divider = node("li", date.toLocaleDateString("vi-VN", {day:"numeric",month:"long",year:"numeric"}));
      divider.className = "day";
      items.push(divider);
      lastDay = day;
    }
    const li = node("li", "");
    li.className = p.author === me.email ? "message mine" : "message";
    const bubble = node("div", "");
    bubble.className = "bubble";
    const type = {skill:" · Skill",task:" · Công việc"}[p.kind] || "";
    const meta = node("small", (p.author === me.email ? "Bạn" : p.author.split("@")[0]) + type + " · " +
      date.toLocaleTimeString("vi-VN", {hour:"2-digit",minute:"2-digit"}));
    meta.title = p.author + " · " + date.toLocaleString("vi-VN");
    if (p.kind === "file") bubble.append(attachmentCard(p));
    else {
      bubble.append(node("pre", p.body));
      const invitation = p.kind === "text" && URL.canParse(p.body) ? new URL(p.body) : null;
      const token = invitation?.origin === location.origin && new URLSearchParams(invitation.hash.slice(1)).get("join");
      if (token && /^[a-f0-9-]{36}$/.test(token)) bubble.append(button("Mở lời mời nhóm", () => {
        joinToken = token; return showGroupInvitation();
      }));
      if (p.kind !== "text") bubble.append(button(p.kind === "skill" ? "Lưu bản sao skill" : "Nhận việc", async () => {
        await api("saved", {seq:p.seq,action:"save"});
        status("Đã lưu vào mục Skill và việc đã nhận của bạn.");
      }));
    }
    if (grouped && !type) {
      li.classList.add("continued");
      meta.className = "sr";
    }
    const room = rooms.find(r => r.id === current);
    if (room?.kind === "group" && (p.author === me.email || room.isOwner || (room.admin && !moderators.has(p.author)))) {
      const options=node("details","");
      options.className="message-options"; options.append(node("summary","Tùy chọn tin nhắn"));
      options.append(button("Xóa tin nhắn",async () => {
        if (!window.confirm("Xóa tin nhắn này cho cả nhóm?")) return;
        await api("rooms/"+room.id+"/moderate",{action:"deletePost",seq:p.seq}); readingOlder=false; await refresh();
      })); li.append(options);
    }
    bubble.title = meta.title;
    li.append(meta, bubble);
    previous = p;
    items.push(li);
  }
  el("posts").replaceChildren(...items);
  if (!items.length) el("posts").append(node("li", "Chưa có tin nhắn."));
}
function updateComposer() {
  const busy = Boolean(activeBatch);
  el("sending").hidden = !busy;
  el("sending").textContent = busy ? (attachments.length ? "Đang gửi " + attachments[0].file.name + "…" : "Đang gửi…") : "";
  el("draft").readOnly = busy;
  el("attach").disabled = busy || el("compose").elements.kind.value !== "text";
  el("compose").elements.kind.disabled = busy || attachments.length > 0;
  el("submit-post").disabled = busy || (!el("draft").value.trim() && !attachments.length);
  el("compose").setAttribute("aria-busy", String(busy));
}
function removeAttachment(item) {
  attachments = attachments.filter((entry) => entry !== item);
  if (item.preview) URL.revokeObjectURL(item.preview);
  renderAttachments();
}
function renderAttachments() {
  el("attachments").hidden = !attachments.length;
  el("attachments").replaceChildren(...attachments.map((item) => {
    const chip = node("div", "");
    chip.className = "file-chip";
    const remove = button("Bỏ tệp " + item.file.name, () => removeAttachment(item));
    remove.setAttribute("aria-label", remove.textContent);
    remove.title = remove.textContent;
    remove.replaceChildren(icon("close"));
    remove.disabled = Boolean(activeBatch);
    chip.append(item.preview ? thumbnail(item.preview) : icon("file"), fileDetails(item.file.name, item.file.size), remove);
    if (isMarkdown(item.file.name)) {
      const share = button("Chia sẻ dưới dạng skill", () => previewMarkdown(item));
      share.className = "share-markdown";
      share.disabled = Boolean(activeBatch);
      chip.querySelector(".file-details").append(share);
    }
    return chip;
  }));
  updateComposer();
}
function stageFiles(files) {
  if (!files.length || !current || !me || el("compose").hidden || activeBatch || el("attach").disabled) return;
  status("");
  for (const file of files) {
    if (!file.size || file.size > me.maxFileBytes) {
      fail(Error(file.size ? "request_too_large" : "empty_file"));
      continue;
    }
    attachments.push({file, nonce:crypto.randomUUID(), preview:canPreview(file.name) &&
      /^image\/(png|jpeg|gif|webp)$/.test(file.type) ? URL.createObjectURL(file) : null});
  }
  renderAttachments();
}
el("attach").onclick = () => el("files").click();
el("files").onchange = () => {
  stageFiles(Array.from(el("files").files));
  el("files").value = "";
  el("draft").focus();
};
el("draft").oninput = updateComposer;
el("compose").onpaste = (event) => {
  if (event.clipboardData.files.length && !el("attach").disabled) {
    event.preventDefault();
    stageFiles(Array.from(event.clipboardData.files));
  }
};
for (const name of ["dragover","drop"]) el("room").addEventListener(name,(event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  if (event.type === "drop" && !el("conversation").hidden) stageFiles(Array.from(event.dataTransfer.files));
});
async function smallerBody(blob, markdown = false) {
  if (typeof CompressionStream !== "function" || blob.size < (markdown ? 2048 : 128 * 1024)) return blob;
  const packed = await new Response(blob.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return packed.size <= blob.size * 0.95 ? packed : blob;
}

function fileCompressor() {
  const worker = new Worker("/file-compressor.js", { type: "module" });
  let next = 0;
  let failed = false;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    pending.get(data.id)?.(data.bytes);
    pending.delete(data.id);
  };
  worker.onerror = () => {
    failed = true;
    for (const finish of pending.values()) finish(null);
    pending.clear();
  };
  return {
    async compress(blob) {
      if (failed) return blob;
      const id = next++;
      const bytes = await new Promise((finish) => {
        pending.set(id, finish);
        worker.postMessage({ id, blob });
      });
      return bytes && bytes.length <= blob.size * 0.95 ? new Blob([bytes]) : blob;
    },
    close() { worker.terminate(); },
  };
}

async function postFile(url, body, headers) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { method: "POST", headers, body });
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= 2) throw error;
    }
    if (response?.ok) return response;
    if (attempt < 2 && (!response || [502, 503, 504].includes(response.status))) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (response.status === 401) signedOut();
    const details = await response.json().catch(() => ({}));
    throw Error(details.error || "upload_failed");
  }
}

async function uploadParts(url, item, headers, partSize, batchParts, compressor) {
  const pack = (blob) => compressor ? compressor.compress(blob) : smallerBody(blob);
  const encoding = compressor ? "br" : "gzip";
  const parts = [];
  const hashes = [];
  for (let offset = 0; offset < item.file.size; offset += partSize) {
    const part = item.file.slice(offset, offset + partSize);
    parts.push(part);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await part.arrayBuffer()));
    hashes.push(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""));
  }
  const manifest = JSON.stringify({ size: item.file.size, hashes });
  const start = await postFile(url + "/start", manifest, { ...headers, "content-type": "application/json" });
  const { published, received } = await start.json();
  if (published) return;
  const missing = parts.map((_, i) => i).filter((i) => !received.includes(i));
  const groups = [];
  for (const index of missing) {
    const last = groups.at(-1);
    if (last && last.length < batchParts && last.at(-1) + 1 === index) last.push(index);
    else groups.push([index]);
  }
  async function sendPart(group) {
    const index = group[0];
    if (group.length > 1) {
      const slice = item.file.slice(index * partSize, (group.at(-1) + 1) * partSize);
      const packed = await pack(slice);
      if (packed !== slice && packed.size <= partSize) {
        await postFile(url + "/" + index, packed, { ...headers, "x-inbox-encoding": encoding, "x-inbox-parts": String(group.length) });
        return;
      }
    }
    for (const n of group) {
      const body = await pack(parts[n]);
      await postFile(url + "/" + n, body, { ...headers, "x-inbox-encoding": body === parts[n] ? "identity" : encoding });
    }
  }
  const started = performance.now();
  if (groups.length) await sendPart(groups[0]);
  const firstMs = performance.now() - started;
  let concurrency = firstMs < 3000 ? 3 : firstMs < 20000 ? 2 : 1;
  let next = 1;
  let failure;
  async function sendNext(_, lane) {
    while (lane < concurrency && !failure && next < groups.length) {
      const group = groups[next++];
      try {
        const at = performance.now();
        await sendPart(group);
        if (performance.now() - at > Math.max(15000, 2.5 * firstMs)) concurrency = 1;
      } catch (error) {
        failure = error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, sendNext));
  if (failure) throw failure;
  await postFile(url + "/complete", null, headers);
}

async function uploadFile(room, item) {
  const url = "/api/rooms/" + room + "/files/" + item.nonce;
  const headers = { "content-type": "application/octet-stream", "x-inbox-name": encodeURIComponent(item.file.name) };
  const partSize = me.filePartBytes;
  if (partSize && item.file.size > 2 * partSize) {
    const middle = Math.floor(item.file.size / 2);
    const sample = new Blob([item.file.slice(0, 65536), item.file.slice(middle, middle + 65536), item.file.slice(-65536)]);
    const packedSample = me.fileGzip ? await smallerBody(sample) : sample;
    const compressible = packedSample !== sample;
    if (!compressible || item.file.size > 20_000_000 || item.file.size * packedSample.size / sample.size > 2 * partSize) {
      const codec = compressible && me.fileBrotli && typeof Worker === "function" ? fileCompressor() : null;
      try {
        const br = codec ? await codec.compress(sample) : sample;
        const useBr = codec && br.size < packedSample.size * 0.98;
        const ratio = sample.size / (useBr ? br.size : packedSample.size);
        const batch = Math.min(me.fileBatchParts ?? 1, Math.max(1, Math.floor(ratio * 0.85)));
        await uploadParts(url, item, headers, partSize, batch, useBr ? codec : null);
      } finally {
        codec?.close();
      }
      return;
    }
  }
  const body = me.fileGzip ? await smallerBody(item.file, isMarkdown(item.file.name)) : item.file;
  if (partSize && body.size > 2 * partSize)
    return uploadParts(url, item, headers, partSize, me.fileBatchParts ?? 1);
  await postFile(body === item.file ? url : url + "/gzip", body, headers);
}
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

let signalSocket;
let reconnectTimer;
let reconnectDelay = 1000;
let pendingSignal = false;
function disconnectSignals() {
  clearTimeout(reconnectTimer);
  pendingSignal = false;
  const socket = signalSocket;
  signalSocket = null;
  socket?.close();
}
function connectSignals() {
  if (!me?.signals || document.hidden || signalSocket) return;
  const url = new URL("/api/events", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  signalSocket = socket;
  socket.onopen = () => {
    if (signalSocket !== socket) return;
    reconnectDelay = 1000;
    pendingSignal = true;
    pollRooms(true);
  };
  socket.onmessage = (event) => {
    if (signalSocket !== socket || event.data !== "changed") return;
    pendingSignal = true;
    pollRooms(true);
  };
  socket.onclose = () => {
    if (signalSocket !== socket) return;
    signalSocket = null;
    reconnectTimer = setTimeout(connectSignals, reconnectDelay);
    reconnectDelay = Math.min(30000, reconnectDelay * 2);
  };
}
let lastPollAt = 0;
async function pollRooms(immediate = false) {
  if (refreshes || !me || viewingSaved || document.hidden) return;
  const now = Date.now();
  const interval = signalSocket?.readyState === WebSocket.OPEN ? 15000 : current && now - lastActivity < 60_000 ? 2500 : 5000;
  if (!immediate && !pendingSignal && now - lastPollAt < interval) return;
  pendingSignal = false;
  lastPollAt = now;
  try {
    await refresh(true);
  } catch (error) {
    fail(error);
  }
}
setInterval(pollRooms, 500);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) disconnectSignals();
  else {
    connectSignals();
    lastActivity = Date.now();
    pollRooms(true);
  }
});
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
    else if (joinToken) void showGroupInvitation();
  });
