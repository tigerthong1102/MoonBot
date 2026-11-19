import { language, languageNames, setLanguage, t } from "./inbox-i18n.js";
import { groupBots } from "./group-bots.js";
import { groupControls } from "./group-controls.js";
import { installInboxSelects } from "./inbox-select.js";
installInboxSelects();
const el = (id) => document.getElementById(id);
el("desktop-back").hidden = new URLSearchParams(location.search).get("desktop") !== "1";
for (const back of document.querySelectorAll(".list-back")) {
  back.onclick = () => { delete document.body.dataset.thread; };
}
const accountOnly = !el("desktop-back").hidden && new URLSearchParams(location.search).get("account") === "1";
const skin = new URLSearchParams(location.search).get("skin");
if (skin) document.documentElement.dataset.skin = skin;
const node = (tag, text) => Object.assign(document.createElement(tag), { textContent: text, dir: "auto" });
const entry = new URLSearchParams(location.hash.slice(1));
let joinToken = entry.get("join"), invitedRoom = entry.get("room"), moderators = new Set();
let statusTimer;
const status = (text, persistent = false) => {
  clearTimeout(statusTimer);
  el("status").textContent = text;
  if (text && !persistent) statusTimer = setTimeout(() => { el("status").textContent = ""; }, 4500);
};
let pickedLanguage = false;
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
    upload_unavailable: t("personalInbox.uploadUnavailable"),
    invalid_filename: t("personalInbox.invalidName"),
    empty_file: t("personalInbox.emptyFile"),
    skill_file_text: t("personalInbox.skillEncoding"),
    skill_file_length: t("personalInbox.skillLength"),
    request_too_large: me ? t("personalInbox.maxSize", { size: fileSize(me.maxFileBytes) }) : t("personalInbox.tooLarge"),
    rate_limited: t("personalInbox.rateLimit"),
    room_limit_or_conflict:
      t("personalInbox.roomLimit"),
    unavailable: t("personalInbox.unavailable"),
    auth_failed: t("personalInbox.invalidCode"),
    contains_secret: t("personalInbox.secret"),
    unauthorized: t("personalInbox.signInRequired"),
    invalid_request: t("personalInbox.invalidInput"),
  };
  status(errors[error.message] || t("personalInbox.retry"), true);
}
async function api(path, data) {
  const res = await fetch(
    "/api/" + path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-inbox-language": language, "x-inbox-language-source": pickedLanguage || !el("desktop-back").hidden ? "app" : "default", ...(joinToken && path.startsWith("auth/") ? {"x-inbox-invite":joinToken} : {}) },
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
  el("invite-link-field").value = "";
  el("invite-link-field").hidden = true;
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
  delete el("actions").dataset.view;
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
    t("personalInbox.checkMail", { email }),
  );
  button.textContent = t("personalInbox.resendWait");
  setTimeout(() => {
    button.textContent = t("personalInbox.sendCode");
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
  status(t("personalInbox.signedOut"));
});
async function start() {
  me = await api("me");
  if (pickedLanguage || !el("desktop-back").hidden || !me.locale) {
    if (me.locale !== language) await api("language",{locale:language});
  } else chooseLanguage(me.locale);
  pickedLanguage = false;
  el("account").textContent = me.email;
  el("attach").title = t("personalInbox.attachLimit", { size: fileSize(me.maxFileBytes) });
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
    el("join-title").textContent = t("personalInbox.joinTitle", { group: info.title });
    el("join-button").textContent = info.approval ? t("personalInbox.requestJoin") : t("personalInbox.joinGroup");
    el("join-button").hidden = !me;
    el("join-prompt").hidden = false;
  } catch { el("join-prompt").hidden = true; status(t("personalInbox.expiredLink"),true); }
}
window.addEventListener("hashchange", run(async () => {
  const params = new URLSearchParams(location.hash.slice(1));
  joinToken = params.get("join");
  invitedRoom = params.get("room");
  el("join-prompt").hidden = true;
  if (joinToken) await showGroupInvitation();
  else if (me && invitedRoom) {
    await refresh();
    if (rooms.some(r => r.id === invitedRoom)) await select(invitedRoom);
  }
}));
el("join-button").onclick = run(async () => {
  const response = await api("join",{token:joinToken});
  joinToken = null; history.replaceState(null,"",location.pathname + location.search); el("join-prompt").hidden = true;
  if (response.state === "requested") status(t("personalInbox.requested"),true);
  else await select(response.id);
});
function roomName(r) {
  return r.kind === "direct" && !r.isOwner ? r.inviter : r.title;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "/inbox-icons.svg#i-" + name);
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}
function avatarContent(room) {
  return room.kind === "group" ? icon("group") : roomName(room).trim().slice(0, 1).toLocaleUpperCase(language);
}
function renderRooms() {
  const list = el("rooms");
  const focusedRoom = list.contains(document.activeElement) ? document.activeElement.closest("button")?.dataset.room : null;
  const query = el("filter").value.trim().toLocaleLowerCase(language);
  const visible = rooms.filter((room) => roomName(room).toLocaleLowerCase(language).includes(query));
  list.replaceChildren(...visible.map((r) => {
    const name = roomName(r);
    const title = r.state === "pending" ? t("personalInbox.invitationLabel", { name }) : name;
    const row = button(title, () => select(r.id));
    const avatar = node("span", "");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.append(avatarContent(r));
    const text = node("span", "");
    text.className = "room-name";
    text.append(node("strong", name), node("small", r.state === "pending" ? t("personalInbox.invitation") :
      r.snippet || (r.kind === "group" ? t("personalInbox.group") : t("personalInbox.direct"))));
    row.dataset.room = r.id;
    row.setAttribute("aria-label", title);
    row.title = title;
    row.setAttribute("aria-current", String(r.id === current && !viewingSaved));
    row.replaceChildren(avatar, text);
    return row;
  }));
  if (focusedRoom) (list.querySelector('button[data-room="' + CSS.escape(focusedRoom) + '"]') ?? el("filter")).focus({preventScroll:true});
  if (!visible.length) list.append(node("p", query ? t("personalInbox.noMatches") : t("personalInbox.noRooms")));
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
  el("room-meta").textContent = r.state === "pending" ? t("personalInbox.invitation") : r.kind === "group" ? t("personalInbox.group") : t("personalInbox.direct");
  const actions = el("actions");
  const act = (text, route, message) =>
    button(text, async () => {
      await api("rooms/" + r.id + "/" + route, {});
      status(message);
      await refresh();
    });
  if (r.state === "pending") {
    el("conversation").hidden = true;
    const invitation = JSON.stringify([r.id, r.inviter, language]);
    if (actions.dataset.view === invitation) return;
    actions.dataset.view = invitation;
    actions.replaceChildren(
      node("p", t("personalInbox.inviteFrom", { email: r.inviter })),
      act(t("personalInbox.join"), "accept", t("personalInbox.joined")),
      act(t("personalInbox.decline"), "leave", t("personalInbox.declined")),
      act(t("personalInbox.blockInviter"), "block", t("personalInbox.inviterBlocked")),
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
  const field = el("invite-link-field");
  if (field.value && (!detail.group.link || new URL(field.value).hash !== "#join=" + detail.group.link)) {
    field.hidden = true;
    field.value = "";
  }
  const group = r.kind === "group";
  const manager = group && (r.isOwner || r.admin);
  el("invite").hidden = !manager;
  el("quick-invite").hidden = !(group && (manager || detail.group.link));
  el("quick-invite").textContent = manager ? t("personalInbox.inviteGroup") : t("personalInbox.shareLink");
  moderators = new Set(detail.members.filter(m => m.admin || m.id === detail.group.owner).map(m => m.email));
  const oldRevision = previousRoom?.revision;
  if (group && oldRevision !== r.revision) readingOlder = false;
  const panel = el("room-options");
  if (!poll || panel.dataset.room !== r.id || panel.dataset.revision !== String(r.revision)) {
    panel.dataset.room=r.id; panel.dataset.revision=String(r.revision);
    const botPanelOpen = panel.dataset.botRoom === r.id && el("manage").querySelector("[data-bots]")?.open;
    panel.dataset.botRoom = r.id;
    el("manage").replaceChildren();
    if (group) {
      const ui = groupControls({room:r,detail,me,node,button,api,refresh,status});
      el("members").replaceChildren(ui.list); el("manage").append(ui.controls);
      const bots = groupBots({room:r,me,node,button,api,refresh,status});
      bots.dataset.bots = ""; el("manage").append(bots); bots.open = !!botPanelOpen;
    } else el("members").replaceChildren(...detail.members.map(m => node("li", m.email)));
    if (r.isOwner && r.kind === "direct" && detail.members.length === 2)
    el("manage").append(act(t("personalInbox.blockPerson"), "block", t("personalInbox.blocked")));
    if (r.isOwner)
    el("manage").append(
      button(t("personalInbox.closeRoom"), async () => {
        if (!window.confirm(t("personalInbox.confirmClose"))) return;
        await api("rooms/" + r.id + "/close", {});
        clearRoom();
        await refresh();
      }),
    );
    else
    el("manage").append(
      act(t("personalInbox.leave"), "leave", t("personalInbox.left")),
      act(t("personalInbox.leaveBlock"), "block", t("personalInbox.leftBlocked")),
    );
  }
  const waiting = r.kind === "direct" && detail.members.length !== 2;
  const limited = group && (r.muted || (r.announcements && !manager));
  el("compose").hidden = !!(waiting || limited);
  el("post-limited").hidden = !limited;
  if (limited) el("post-limited").textContent = r.muted ? t("personalInbox.readOnly") : t("personalInbox.adminPostOnly");
  if (r.kind === "group") el("room-meta").textContent = t("personalInbox.memberCount", { count: detail.members.length });
  const activeActions = readingOlder ? "history-" + language : "active";
  if (actions.dataset.view !== activeActions) {
    actions.dataset.view = activeActions;
    actions.replaceChildren();
    if (readingOlder) actions.append(
      button(t("personalInbox.latest"), async () => {
        readingOlder = false;
        await refresh();
      }),
    );
  }
  if (!readingOlder) {
    const previous = posts.at(-1)?.seq;
    const history = el("history");
    const latestVisible = history.scrollHeight - history.scrollTop - history.clientHeight < 70;
    const changed = oldRevision !== r.revision || !el("posts").childElementCount || previous !== detail.posts.at(-1)?.seq ||
      posts[0]?.seq !== detail.posts[0]?.seq || posts.length !== detail.posts.length;
    posts = detail.posts;
    el("older").hidden = !detail.more;
    if (changed || !posts.length || el("posts").lang !== language) renderPosts();
    if (changed && posts.length) lastActivity = Date.now();
    if (previous !== posts.at(-1)?.seq && (!previous || latestVisible || posts.at(-1)?.author === me.email)) {
      history.scrollTop = history.scrollHeight;
    }
  }
  if (readingOlder && el("posts").lang !== language) renderPosts();
  if (waiting) el("posts").replaceChildren(node("li", t("personalInbox.waitingDirect")));
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
  form.querySelector("button").textContent = group ? t("personalInbox.createGroup") : t("personalInbox.openChat");
  el("target-label").textContent = group ? t("personalInbox.groupName") : t("personalInbox.recipientEmail");
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
el("cancel-invite").onclick = run(async () => {
  const field = el("invite").elements.email;
  if (!field.reportValidity()) return;
  await api("rooms/" + current + "/moderate", {action:"cancelInvite",email:field.value.trim()});
  status(t("personalInbox.cancelledInvite"));
});
el("invite").onsubmit = run(async () => {
  const form = el("invite");
  await api("rooms/" + current + "/invite", {
    email: form.elements.email.value.trim(),
    guest: { locale: form.elements.locale.value, note: form.elements.note.value.trim() },
  });
  el("invite").reset();
  status(t("personalInbox.invited"));
});
function composeLabels() {
  const kind = el("compose").elements.kind.value;
  el("draft-label").textContent = {
    text: t("personalInbox.messages"),
    skill: t("personalInbox.skillBody"),
    task: t("personalInbox.taskBody"),
  }[kind];
  const action = kind === "text" ? t("personalInbox.send") : t("personalInbox.reviewSend");
  el("draft").placeholder = kind === "text" ? t("personalInbox.messagePlaceholder") : el("draft-label").textContent;
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
  el("audience").textContent = t("personalInbox.shareAudience", { room: el("title").textContent });
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
  el("audience").textContent = t("personalInbox.fileAudience", { file: item.file.name, room: el("title").textContent });
  el("preview-body").textContent = body;
  el("preview").showModal();
}
const canPreview = (name) => /\.(?:png|jpe?g|gif|webp)$/i.test(name);
function fileSize(bytes) {
  if (bytes >= 1_000_000) return new Intl.NumberFormat(language, {maximumFractionDigits: 2}).format(bytes / 1_000_000) + " MB";
  if (bytes < 1024) return bytes + " B";
  return new Intl.NumberFormat(language, {maximumFractionDigits: 1}).format(bytes / 1024) + " KiB";
}
function fileDetails(name, size) {
  const details = node("span", "");
  details.className = "file-details";
  const type = /^skill\.md$/i.test(name) ? t("personalInbox.markdownSkill") : isMarkdown(name) ? t("personalInbox.markdown") : name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toUpperCase() || t("personalInbox.file");
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
  link.setAttribute("aria-label", t("personalInbox.downloadFile", { file: post.body }));
  if (canPreview(post.body)) link.append(thumbnail(link.href + "?preview=1"));
  const row = node("span", "");
  row.className = "file-row";
  row.append(icon("file"), fileDetails(post.body, post.fileSize), icon("down"));
  link.append(row);
  return link;
}
function renderPosts() {
  const list = el("posts");
  const active = document.activeElement;
  const focused = list.contains(active) ? active.closest("[data-seq]") : null;
  const controls = "button, a, summary";
  const focusIndex = focused ? [...focused.querySelectorAll(controls)].indexOf(active) : -1;
  const expanded = new Set([...list.querySelectorAll("details[open]")].map(option => option.closest("[data-seq]")?.dataset.seq));
  const relabeling = list.lang !== language;
  list.lang = language;
  const items = [];
  let lastDay, previous;
  for (const p of posts) {
    const date = new Date(p.created);
    const day = date.toLocaleDateString(language);
    const grouped = day === lastDay && previous?.author === p.author && previous?.botName === p.botName && p.created - previous.created < 120000;
    if (day !== lastDay) {
      const divider = node("li", date.toLocaleDateString(language, {day:"numeric",month:"long",year:"numeric"}));
      divider.className = "day";
      items.push(divider);
      lastDay = day;
    }
    const li = node("li", "");
    li.dataset.seq = String(p.seq);
    li.className = p.author === me.email ? "message mine" : "message";
    const bubble = node("div", "");
    bubble.className = "bubble";
    const type = {skill:t("personalInbox.skillSuffix"),task:t("personalInbox.taskSuffix")}[p.kind] || "";
    const meta = node("small", (p.botName ? t("personalInbox.botOwner",{bot:p.botName,owner:p.author}) : p.author === me.email ? t("personalInbox.you") : p.author.split("@")[0]) + type + " · " +
      date.toLocaleTimeString(language, {hour:"2-digit",minute:"2-digit"}));
    meta.title = p.author + " · " + date.toLocaleString(language);
    if (p.kind === "file") bubble.append(attachmentCard(p));
    else {
      bubble.append(node("pre", p.body));
      const invitation = p.kind === "text" && URL.canParse(p.body) ? new URL(p.body) : null;
      const token = invitation?.origin === location.origin && new URLSearchParams(invitation.hash.slice(1)).get("join");
      if (token && /^[a-f0-9-]{36}$/.test(token)) bubble.append(button(t("personalInbox.openInvite"), () => {
        joinToken = token; return showGroupInvitation();
      }));
      if (p.kind !== "text") bubble.append(button(p.kind === "skill" ? t("personalInbox.saveSkill") : t("personalInbox.acceptTask"), async () => {
        await api("saved", {seq:p.seq,action:"save"});
        status(t("personalInbox.savedItem"));
      }));
    }
    if (grouped && !type) {
      li.classList.add("continued");
      meta.className = "sr";
    }
    const room = rooms.find(r => r.id === current);
    if (room?.kind === "group" && (p.author === me.email || room.isOwner || (room.admin && !moderators.has(p.author)))) {
      const options=node("details","");
      options.className="message-options";
      options.open = expanded.has(String(p.seq));
      const toggle=node("summary",""); toggle.append(icon("more")); toggle.setAttribute("aria-label",t("personalInbox.messageOptions")); toggle.title=t("personalInbox.messageOptions"); options.append(toggle);
      options.append(button(t("personalInbox.deletePost"),async () => {
        await api("rooms/"+room.id+"/moderate",{action:"deletePost",seq:p.seq}); readingOlder=false; await refresh();
      })); li.append(options);
    }
    bubble.title = meta.title;
    li.append(meta, bubble);
    previous = p;
    items.push(li);
  }
  list.replaceChildren(...items);
  if (focusIndex >= 0) {
    const row = list.querySelector('[data-seq="' + CSS.escape(focused.dataset.seq) + '"]');
    const target = row?.querySelectorAll(controls)[focusIndex];
    if (target?.tagName === active.tagName && (relabeling || target.textContent === active.textContent)) target.focus({preventScroll:true});
  }
  if (!items.length) el("posts").append(node("li", t("personalInbox.noMessages")));
}
function updateComposer() {
  const busy = Boolean(activeBatch);
  el("sending").hidden = !busy;
  el("sending").textContent = busy ? (attachments.length ? t("personalInbox.sendingFile", { file: attachments[0].file.name }) : t("personalInbox.sending")) : "";
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
    const remove = button(t("personalInbox.removeFile", { file: item.file.name }), () => removeAttachment(item));
    remove.setAttribute("aria-label", remove.textContent);
    remove.title = remove.textContent;
    remove.replaceChildren(icon("close"));
    remove.disabled = Boolean(activeBatch);
    chip.append(item.preview ? thumbnail(item.preview) : icon("file"), fileDetails(item.file.name, item.file.size), remove);
    if (isMarkdown(item.file.name)) {
      const share = button(t("personalInbox.shareAsSkill"), () => previewMarkdown(item));
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
        node("small", p.kind === "skill" ? t("personalInbox.skill") : p.done ? t("personalInbox.completedTask") : t("personalInbox.receivedTask")),
        node("pre", p.body),
      );
      if (p.kind === "skill")
        item.append(
          button(t("personalInbox.downloadSkill"), () => {
            const link = document.createElement("a");
            link.download = "SKILL.md";
            link.href = URL.createObjectURL(new Blob([p.body], { type: "text/plain;charset=utf-8" }));
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          }),
        );
      if (p.kind === "task" && !p.done)
        item.append(
          button(t("personalInbox.complete"), async () => {
            await api("saved", { seq: p.seq, action: "done" });
            await showSaved();
          }),
        );
      item.append(
        button(t("personalInbox.deleteCopy"), async () => {
          await api("saved", { seq: p.seq, action: "delete" });
          await showSaved();
        }),
      );
      return item;
    }),
  );
  if (!saved.length) el("saved-list").append(node("p", t("personalInbox.noSaved")));
}
el("open-saved").onclick = run(showSaved);
async function showBlocked() {
  const { people } = await api("blocks");
  el("blocked-list").replaceChildren(
    ...people.map((p) => {
      const li = node("li", p.email);
      li.append(
        button(t("personalInbox.unblock"), async () => {
          await api("blocks", { person: p.id });
          await showBlocked();
        }),
      );
      return li;
    }),
  );
  if (!people.length) el("blocked-list").append(node("li", t("personalInbox.noBlocks")));
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
function chooseLanguage(tag) {
  setLanguage(tag);
  el("mail-lang").value = language;
  for (const selector of document.querySelectorAll('select[name="locale"]')) {
    for (const option of selector.options) option.defaultSelected = option.value === language;
  }
  createLabels();
  composeLabels();
  if (!el("verify").hidden) {
    status(t("personalInbox.checkMail", { email: loginEmail }));
    const send = el("send-code").querySelector("button");
    if (send.disabled) send.textContent = t("personalInbox.resendWait");
  }
  if (accountOnly) {
    document.title = t("personalInbox.account");
    document.querySelector("header strong").textContent = document.title;
  }
}
for (const field of document.querySelectorAll('#mail-lang, select[name="locale"]')) {
  for (const [tag, label] of Object.entries(languageNames)) field.add(new Option(label, tag));
}
chooseLanguage(language);
el("mail-lang").closest("label").hidden = !el("desktop-back").hidden;
let savingLanguage = Promise.resolve();
function changeInboxLanguage(tag) {
  chooseLanguage(tag);
  const selected = language;
  const url = new URL(location.href);
  url.searchParams.set("lang", selected);
  history.replaceState(null, "", url);
  renderAttachments();
  if (joinToken) void showGroupInvitation().catch(fail);
  if (!me) return;
  const account = me.id;
  savingLanguage = savingLanguage.then(async () => {
    if (me?.id !== account) return;
    await api("language", {locale:selected});
    if (me?.id === account && language === selected) await (viewingSaved ? showSaved() : refresh());
  }).catch(fail);
}
el("mail-lang").onchange = () => {
  pickedLanguage = !me;
  changeInboxLanguage(el("mail-lang").value);
};
const stopParams = new URLSearchParams(location.hash.slice(1));
if (stopParams.has("stop")) {
  const token = stopParams.get("stop");
  history.replaceState(null, "", location.pathname);
  el("stop-mail").hidden = false;
  el("stop-button").textContent = t("personalInbox.stopMail");
  el("stop-button").onclick = run(async () => {
    await api("stop-invitations", { token });
    el("stop-button").hidden = true;
    el("stop-result").textContent = t("personalInbox.mailStopped");
  });
} else
  start().catch((e) => {
    if (e.message !== "unauthorized") fail(e);
    else if (joinToken) void showGroupInvitation();
  });

window.addEventListener("inbox-language", event => {
  if (typeof event.detail === "string") changeInboxLanguage(event.detail);
});
window.addEventListener("inbox-bots-changed", () => void refresh().catch(fail));
window.addEventListener("inbox-bots-empty", () => status(t("personalInbox.botNone"),true));
window.addEventListener("inbox-bots-error", () => status(t("personalInbox.unavailable"),true));
