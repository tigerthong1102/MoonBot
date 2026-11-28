import { copyText } from "./clipboard-write.js";

let callback = location.pathname === "/mobile/callback" ? new URLSearchParams(location.search) : null;
if (callback) history.replaceState(null, "", "/mobile");
const requestedLanguage = new URLSearchParams(location.search).get("lang") || navigator.language;
const catalog = await (await fetch("/mobile/messages?lang=" + encodeURIComponent(requestedLanguage))).json();
const locale = catalog.locale;
const t = key => Object.hasOwn(catalog.messages, key) ? catalog.messages[key] : undefined;
document.documentElement.lang = locale;
const el = id => document.getElementById(id);
for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
for (const node of document.querySelectorAll("[data-t-label]")) node.setAttribute("aria-label", t(node.dataset.tLabel));
let account, thread, busy = false, active, pending, connection;
let conversations = [], before, newThread;
const drafts = new Map();
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("startupbot-account") : null;
channel?.addEventListener("message", () => location.reload());
window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
window.addEventListener("pagehide", () => { active?.abort(); el("chat").hidden = true; el("transcript").replaceChildren(); });
function status(message = "") { el("status").textContent = message; }
function signedOut() {
  pending = newThread = undefined;
  drafts.clear();
  account = undefined;
  thread = undefined;
  conversations = [];
  connection = undefined;
  el("chat").hidden = el("logout").hidden = true;
  el("login").hidden = false;
  el("codeBox").hidden = el("changeEmail").hidden = true;
  el("otp").required = false;
  el("email").readOnly = false;
  el("loginButton").textContent = t("code");
  el("transcript").replaceChildren();
  el("usage").open = false;
  el("usageText").textContent = "";
  el("sessions").open = false;
  el("sessionList").replaceChildren();
  el("tools").open = el("skills").open = false;
  el("devices").open = false;
  el("deviceList").replaceChildren();
  el("threads").replaceChildren();
  el("login").reset();
  el("compose").reset();
}
async function api(path, body, signal) {
  const response = await fetch("/mobile/" + path, {
    method: body ? "POST" : "GET", headers: body ? { "content-type":"application/json" } : {},
    body: body ? JSON.stringify({ ...body, account }) : undefined, signal, redirect:"error", cache:"no-store"
  });
  if (!response.ok) {
    const code = (await response.json()).error?.code;
    if (response.status === 401 && path !== "login") signedOut();
    if (code === "account_changed") location.reload();
    const message = code === "request_exists" ? t("interrupted") : t(code) || (code === "account_unavailable" ? t("unavailable") : t("error"));
    throw Object.assign(Error(message), { code });
  }
  return response;
}
async function list() {
  const data = await (await api("threads")).json();
  if (account && account !== data.account) { location.reload(); return; }
  account = data.account;
  conversations = data.threads;
  if (conversations.some(item => item.id === newThread)) newThread = undefined;
  for (const id of drafts.keys()) {
    if (id !== newThread && !conversations.some(item => item.id === id)) drafts.delete(id);
  }
  connection = data.provider;
  for (const option of el("skill").options) option.disabled = data.disabledSkills?.includes(option.value) ?? false;
  if (el("skill").selectedOptions[0]?.disabled) el("skill").value = [...el("skill").options].find(o => !o.disabled)?.value ?? "";
  el("providers").hidden = !connection?.enabled && !connection?.connected;
  el("connectProvider").hidden = !connection?.enabled || connection.connected;
  el("disconnectProvider").hidden = !connection?.connected;
  el("providerKeys").href = connection?.settingsURL || "https://openrouter.ai/keys";
  const options = data.threads.map(item => new Option(item.title, item.id));
  el("threads").replaceChildren(new Option(t("empty"), ""), ...options);
  el("threads").value = options.some(o => o.value === thread) ? thread : "";
  payer();
  return data.threads;
}
function payer() {
  const saved = conversations.find(item => item.id === thread);
  el("billing").hidden = !connection?.connected && saved?.provider !== "openrouter";
  el("provider").disabled = Boolean(saved);
  if (saved) el("provider").value = saved.provider;
  else if (!connection?.connected && el("provider").value === "openrouter") {
    el("provider").value = "managed";
    el("consent").checked = false;
  }
  el("provider").options[1].disabled = !connection?.connected;
}
function bubble(speaker, text, container = el("transcript")) {
  const block = document.createElement("article"), label = document.createElement("small");
  const bubble = document.createElement("div"), paragraph = document.createElement("pre");
  block.className = speaker === t("you") ? "message mine" : "message";
  bubble.className = "bubble";
  label.textContent = speaker;
  paragraph.dir = "auto";
  paragraph.textContent = text;
  bubble.append(paragraph);
  block.append(label, bubble);
  container.append(block);
  return paragraph;
}
function formatAnswer(element, text) {
  const fragment = document.createDocumentFragment();
  for (const [index, part] of text.split(/^```[^\n]*$/gm).entries()) {
    if (index % 2) {
      const code = document.createElement("code"), pre = document.createElement("pre");
      pre.dir = "ltr";
      code.textContent = part.replace(/^\n/, "");
      pre.append(code);
      fragment.append(pre);
    } else {
      for (const line of part.split("\n")) {
        const node = document.createElement(/^#{1,3} /.test(line) ? "strong" : "span");
        node.dir = "auto";
        const content = line.replace(/^#{1,3} /, "").replace(/^[-*] /, "• ");
        for (const [n, word] of content.split("**").entries()) {
          if (n % 2) { const bold = document.createElement("strong"); bold.textContent = word; node.append(bold); }
          else node.append(word);
        }
        fragment.append(node, document.createTextNode("\n"));
      }
    }
  }
  element.replaceChildren(fragment);
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = t("copy");
  copy.onclick = async () => {
    if (await copyText(text) === "failed") status(t("error"));
  };
  element.parentElement.append(copy);
}
async function show(id) {
  if (thread) {
    const prompt = el("prompt").value;
    if (prompt || pending) drafts.set(thread, { prompt, skill:el("skill").value, provider:el("provider").value, pending });
    else drafts.delete(thread);
  }
  if (!id && !newThread) newThread = crypto.randomUUID();
  thread = id || newThread;
  const draft = drafts.get(thread);
  pending = draft?.pending;
  el("transcript").replaceChildren();
  el("compose").reset();
  el("threads").value = id || "";
  if (draft) {
    el("prompt").value = draft.prompt;
    const option = [...el("skill").options].find(o => o.value === draft.skill && !o.disabled);
    if (option) el("skill").value = option.value;
    el("provider").value = draft.provider;
  } else {
    const option = [...el("skill").options].find(o => !o.disabled);
    if (option) el("skill").value = option.value;
  }
  payer();
  before = null;
  el("older").hidden = true;
  if (id) { await loadHistory(); el("history").scrollTop = el("history").scrollHeight; }
}
async function loadHistory(replace = false) {
  const { turns, next } = await (await api("history", { thread, before:replace ? null : before })).json();
  const fragment = document.createDocumentFragment();
  for (const turn of turns) {
    bubble(t("you"), turn.prompt, fragment);
    const answer = bubble(t("bot"), "", fragment);
    if (turn.answer) formatAnswer(answer, turn.answer);
    if (t(turn.state)) answer.append(document.createTextNode(t(turn.state)));
  }
  if (replace) el("transcript").replaceChildren(fragment);
  else el("transcript").prepend(fragment);
  before = next;
  el("older").hidden = !before;
}
function lock(value) {
  busy = value;
  for (const id of ["threads","new","older","rename","remove","send","logout","logoutAll","loginButton","changeEmail","connectProvider","disconnectProvider"]) el(id).disabled = value;
}
async function action(work) {
  if (busy) return;
  lock(true);
  status();
  try { await work(); } catch (error) { status(error.name === "AbortError" ? t("interrupted") : error.message === "Failed to fetch" ? t("error") : error.message); }
  finally { lock(false); }
}
async function openChat() {
  el("retry").hidden = true;
  let threads;
  try { threads = await list(); } catch (error) { el("retry").hidden = !el("login").hidden; throw error; }
  el("prompt").placeholder = t("message");
  el("chat").hidden = el("logout").hidden = false;
  el("login").hidden = true;
  const existing = threads.some(item => item.id === thread) ? thread : threads[0]?.id;
  try { await show(thread && newThread === thread ? "" : existing || ""); }
  catch (error) { el("retry").hidden = false; throw error; }
  if (callback) {
    const authorization = callback;
    callback = null;
    await api("provider/complete", { code:authorization.get("code"), state:authorization.get("state") });
    await list();
    el("tools").open = el("providers").open = true;
  }

}
el("login").onsubmit = event => {
  event.preventDefault();
  action(async () => {
    const email = el("email").value;
    if (el("codeBox").hidden) {
      await api("code", { email });
      el("codeBox").hidden = el("changeEmail").hidden = false;
      el("email").readOnly = el("otp").required = true;
      el("loginButton").textContent = t("login");
      el("otp").focus();
      status(t("delivered"));
    } else {
      await api("login", { email, otp:el("otp").value });
      el("otp").value = "";
      el("login").hidden = true;
      channel?.postMessage("changed");
      await openChat();
    }
  });
};
el("retry").onclick = () => action(openChat);
el("usage").ontoggle = async () => {
  if (!el("usage").open) return;
  const initiatingAccount = account;
  try {
    const usage = await (await api("account-usage", {})).json();
    if (!account || account !== initiatingAccount || !el("usage").open) return;
    const usd = micros => (micros/1000000).toLocaleString(locale, { style:"currency", currency:"USD", maximumFractionDigits:6 });
    el("usageText").textContent = [t("balance") + " · " + usd(usage.available),
      usage.expires && t("expires") + " · " + new Date(usage.expires).toLocaleDateString(locale),
      t("byokUsage") + " · " + usd(usage.byokTodayUTC.settled) + " / " + usd(usage.byokTodayUTC.pending)].filter(Boolean).join("\n");
  } catch (error) { status(error.message); }
};
async function showSessions() {
  const initiatingAccount = account;
  const { sessions } = await (await api("sessions", {})).json();
  if (!account || account !== initiatingAccount || !el("sessions").open) return;
  const items = sessions.map(session => {
    const item = document.createElement("li"), button = document.createElement("button");
    if (session.current) item.append(t("currentSession") + " · ");
    item.append(new Date(session.createdAt).toLocaleString(locale) + " · " + t("expires") + " " + new Date(session.expiresAt).toLocaleString(locale) + " ");
    button.textContent = t("revoke");
    button.onclick = () => action(async () => {
      if (!window.confirm(t("confirmRevoke"))) return;
      await api("sessions/revoke", { sessionId:session.id });
      await showSessions();
    });
    item.append(button);
    return item;
  });
  el("sessionList").replaceChildren(...items);
}
el("sessions").ontoggle = () => {
  if (el("sessions").open) showSessions().catch(error => status(error.message));
};
el("logoutAll").onclick = () => action(async () => {
  if (!window.confirm(t("confirmAll"))) return;
  await api("sessions/logout-all", {});
  signedOut();
  channel?.postMessage("changed");
});
el("devices").ontoggle = async () => {
  if (!el("devices").open) return;
  const viewer = account;
  try {
    const { devices } = await (await api("devices", {})).json();
    if (!account || viewer !== account) return;
    el("deviceList").replaceChildren(...(devices.length ? devices.map(d => [d.name, d.platform, d.appVersion].filter(Boolean).join(" · ")) : [t("noDevices")])
      .map(text => { const item = document.createElement("li"); item.textContent = text; return item; }));
  } catch (error) { status(error.message); }
};
el("connectProvider").onclick = () => action(async () => {
  const { url } = await (await api("provider/start", {})).json();
  location.assign(url);
});
el("disconnectProvider").onclick = () => action(async () => { await api("provider/disconnect", {}); await list(); });
el("changeEmail").onclick = signedOut;
el("logout").onclick = () => action(async () => { await api("logout", {}); signedOut(); channel?.postMessage("changed"); });
el("threads").onchange = () => action(async () => { await show(el("threads").value); el("tools").open = false; });
el("older").onclick = () => action(loadHistory);
el("new").onclick = () => action(async () => { await show(""); el("tools").open = false; el("prompt").focus(); });
el("rename").onclick = () => action(async () => {
  if (!el("threads").value) return;
  const title = window.prompt(t("rename"), el("threads").selectedOptions[0].textContent);
  if (title?.trim()) { await api("rename", { thread, title }); await list(); }
});
el("remove").onclick = () => action(async () => {
  if (el("threads").value && window.confirm(t("confirm"))) {
    await api("delete", { thread });
    drafts.delete(thread);
    thread = pending = undefined;
    await list();
    await show("");
    el("tools").open = false;
  }
});
el("stop").onclick = () => active?.abort();
el("compose").onsubmit = event => {
  event.preventDefault();
  if (!navigator.onLine) { status(t("offline")); return; }
  action(async () => {
    const submitted = el("prompt").value;
    const prompt = submitted.trim();
    if (!prompt) return;
    const skill = el("skill").value;
    const provider = el("provider").value;
    if (!pending || pending.thread !== thread || pending.prompt !== prompt || pending.skill !== skill || pending.provider !== provider) pending = { thread, prompt, skill, provider, id:crypto.randomUUID() };
    const id = pending.id;
    active = new AbortController();
    el("stop").hidden = false;
    status(t("waiting"));
    try {
      const response = await api("send", { thread, id, prompt, provider, runtime:skill === "desktop" ? "desktop" : "text", skill, save:el("consent").checked }, active.signal);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      if (el("prompt").value === submitted) el("prompt").value = "";
      const history = el("history");
      const nearBottom = () => history.scrollHeight - history.clientHeight - history.scrollTop < 64;
      const following = nearBottom();
      bubble(t("you"), prompt);
      const answer = bubble(t("bot"), "");
      if (following) history.scrollTop = history.scrollHeight;
      let buffer = "", state;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += chunk.value;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const frame = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (frame.text) {
            const follow = nearBottom();
            answer.append(document.createTextNode(frame.text));
            if (follow) history.scrollTop = history.scrollHeight;
            status();
          }
          if (frame.state) state = frame.state;
        }
      }
      if (answer.textContent) formatAnswer(answer, answer.textContent);
      pending = undefined;
      status(state === "complete" ? "" : t(state) || t("interrupted"));
    } catch (error) {
      if (error.code !== "request_exists") throw error;
      await loadHistory(true);
      if (el("prompt").value === submitted) el("prompt").value = "";
      pending = undefined;
      status(t("interrupted"));
    } finally {
      el("stop").hidden = true;
      active = undefined;
      if (account) await list().catch(() => { el("retry").hidden = false; });
    }
  });
};
action(openChat);
