import { installInboxSelects } from "./inbox-select.js";
import { copyText } from "./clipboard-write.js";

const el = id => document.getElementById(id);
const locale = document.documentElement.lang;
function readCatalog() {
  let data;
  try { data = JSON.parse(el("mobileCatalog").textContent); } catch { return null; }
  const keys = [...document.querySelectorAll("[data-t], [data-t-label]")].map(node => node.dataset.t || node.dataset.tLabel);
  return data?.locale === locale && keys.every(key => typeof data.messages?.[key] === "string" && data.messages[key]) ? data : null;
}
const catalog = readCatalog();
const t = key => catalog && Object.hasOwn(catalog.messages, key) ? catalog.messages[key] : undefined;
if (catalog) {
  installInboxSelects(document.querySelectorAll("inbox-select, select"));
  for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
  for (const node of document.querySelectorAll("[data-t-label]")) node.setAttribute("aria-label", t(node.dataset.tLabel));
}
let account, thread, busy = false, active, pending;
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("startupbot-account") : null;
channel?.addEventListener("message", () => location.reload());
window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
window.addEventListener("pagehide", () => { active?.abort(); status(); el("chat").hidden = true; el("transcript").replaceChildren(); });
function status(message = "", announcement = message) {
  el("status").textContent = message;
  const live = el("announcement");
  if (live.textContent !== announcement) live.textContent = announcement;
}
function signedOut() {
  active?.abort();
  status();
  pending = undefined;
  account = undefined;
  thread = undefined;
  el("chat").hidden = el("logout").hidden = true;
  el("login").hidden = false;
  el("codeBox").hidden = el("changeEmail").hidden = true;
  el("otp").required = false;
  el("email").readOnly = false;
  el("loginButton").textContent = t("code");
  el("transcript").replaceChildren();
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
    const code = (await response.json().catch(() => null))?.error?.code;
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
  const options = data.threads.map(item => new Option(item.title, item.id));
  el("threads").replaceChildren(new Option(t("empty"), ""), ...options);
  el("threads").value = options.some(o => o.value === thread) ? thread : "";
  return data.threads;
}
function bubble(speaker, text) {
  const block = document.createElement("article"), label = document.createElement("strong"), paragraph = document.createElement("p");
  label.textContent = speaker;
  paragraph.dir = "auto";
  paragraph.textContent = text;
  block.append(label, paragraph);
  el("transcript").append(block);
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
  copy.className = "ui-button";
  copy.type = "button";
  copy.textContent = t("copy");
  copy.onclick = async () => {
    if (await copyText(text) === "failed") status(t("error"));
  };
  element.parentElement.append(copy);
}
async function show(id) {
  thread = id || crypto.randomUUID();
  el("transcript").replaceChildren();
  el("compose").reset();
  el("threads").value = id || "";
  if (id) await refreshTranscript();
}
async function refreshTranscript() {
  const { turns } = await (await api("history", { thread })).json();
  el("transcript").replaceChildren();
  for (const turn of turns) {
    bubble(t("you"), turn.prompt);
    const answer = bubble(t("bot"), "");
    if (turn.answer) formatAnswer(answer, turn.answer);
    if (t(turn.state)) answer.append(document.createTextNode(t(turn.state)));
  }
}
function lock(value) {
  busy = value;
  for (const id of ["threads","new","rename","remove","send","logout","loginButton","changeEmail"]) el(id).disabled = value;
}
async function action(work) {
  if (busy) return;
  lock(true);
  status();
  try { await work(); } catch (error) { status(error.name === "AbortError" ? t("interrupted") : ["TypeError", "SyntaxError"].includes(error.name) ? t("error") : error.message); }
  finally { lock(false); }
}
async function openChat() {
  el("retry").hidden = true;
  let threads;
  try { threads = await list(); } catch (error) { el("retry").hidden = !el("login").hidden; throw error; }
  el("chat").hidden = el("logout").hidden = false;
  el("login").hidden = true;
  await show(threads[0]?.id);
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
el("changeEmail").onclick = signedOut;
el("logout").onclick = () => action(async () => { await api("logout", {}); signedOut(); channel?.postMessage("changed"); });
el("threads").onchange = () => action(() => show(el("threads").value));
el("new").onclick = () => action(() => show(""));
el("rename").onclick = () => action(async () => {
  if (!el("threads").value) return;
  const title = window.prompt(t("rename"), el("threads").selectedOptions[0].textContent);
  if (title?.trim()) { await api("rename", { thread, title }); await list(); }
});
el("remove").onclick = () => action(async () => {
  if (el("threads").value && window.confirm(t("confirm"))) { await api("delete", { thread }); await list(); await show(""); }
});
el("stop").onclick = () => active?.abort();
el("compose").onsubmit = event => {
  event.preventDefault();
  const fromSendButton = document.activeElement === el("send");
  action(async () => {
    const submitted = el("prompt").value;
    const prompt = submitted.trim();
    if (!prompt) return;
    const skill = el("skill").value;
    if (!pending || pending.thread !== thread || pending.prompt !== prompt || pending.skill !== skill) pending = { thread, prompt, skill, id:crypto.randomUUID() };
    const id = pending.id;
    active = new AbortController();
    el("stop").hidden = false;
    if (fromSendButton) el("stop").focus();
    status(t("waiting"));
    try {
      const response = await api("send", { thread, id, prompt, runtime:skill === "desktop" ? "desktop" : "text", skill, save:el("consent").checked }, active.signal);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      if (el("prompt").value === submitted) el("prompt").value = "";
      bubble(t("you"), prompt);
      const answer = bubble(t("bot"), "");
      let buffer = "", state;
      while (true) {
        const chunk = await reader.read();
        active.signal.throwIfAborted();
        if (chunk.done) break;
        buffer += chunk.value;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const frame = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (frame.text) { answer.append(document.createTextNode(frame.text)); status(); }
          if (frame.state) state = frame.state;
        }
      }
      if (answer.textContent) formatAnswer(answer, answer.textContent);
      pending = undefined;
      const notice = state === "complete" ? "" : t(state) || t("interrupted");
      const reply = state === "complete" || state === "limited" ? answer.textContent.trim() : "";
      status(notice, [reply, notice].filter(Boolean).join("\n"));
    } catch (error) {
      if (error.code !== "request_exists") throw error;
      await refreshTranscript();
      if (el("prompt").value === submitted) el("prompt").value = "";
      pending = undefined;
      status(t("interrupted"));
    } finally {
      if (document.activeElement === el("stop") && !el("chat").hidden) el("prompt").focus();
      el("stop").hidden = true;
      active = undefined;
      if (account) await list().catch(() => { el("retry").hidden = false; });
    }
  });
};
if (catalog) {
  el("startupRetry").hidden = true;
  action(openChat);
}
