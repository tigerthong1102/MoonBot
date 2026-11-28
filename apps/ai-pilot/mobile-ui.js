const translations = {
  en: {
    skill:"What would you like to do?", ask:"Ask a question", write:"Draft text", translate:"Translate", summarize:"Summarize text", desktop:"Work on my computer", copy:"Copy", retry:"Reconnect", managed_access_revoked:"AI access has been suspended.", email:"Email address", otp:"Eight-digit email code", code:"Continue with email", login:"Sign in", change:"Change email", logout:"Sign out",
    history:"Conversations", new:"New conversation", rename:"Rename", remove:"Delete", message:"Your message", send:"Send", stop:"Stop",
    consent:"Save this conversation to my StartupBot account and send its recent messages to the AI provider.", confirm:"Delete this conversation from your account?",
    you:"You", bot:"StartupBot", empty:"New conversation", waiting:"Waiting for StartupBot…", running:"Response in progress", limited:"Output limit reached",
    interrupted:"Response interrupted. Check the conversation before sending again.", delivered:"Check your email for the code.",
    personal_credit_exhausted:"Your account has no available AI credit.", account_rate_limit:"Too many requests. Try again later.",
    managed_budget_exhausted:"The shared AI budget has reached its limit.", managed_ai_paused:"AI is paused.", signed_out:"Sign in to continue.",
    desktop_required:"This action needs a connected computer. Open Connect computer in StartupBot. Nothing has been run.",
    thread_full:"Start a new conversation to continue.", history_full:"Delete a conversation to make room.", error:"Unable to complete the request. Check your connection and try again.",
    unavailable:"The account service is temporarily unavailable.", account_changed:"Your account changed. Reopen the conversation.", invalid_message:"Shorten your message and confirm the storage choice."
  },
  vi: {
    skill:"Bạn muốn làm gì?", ask:"Hỏi đáp", write:"Soạn nội dung", translate:"Dịch", summarize:"Tóm tắt văn bản", desktop:"Thao tác trên máy tính", copy:"Sao chép", retry:"Kết nối lại", managed_access_revoked:"Quyền sử dụng AI đã bị tạm ngưng.", email:"Địa chỉ email", otp:"Mã tám chữ số gửi qua email", code:"Tiếp tục bằng email", login:"Đăng nhập", change:"Đổi email", logout:"Đăng xuất",
    history:"Hội thoại", new:"Hội thoại mới", rename:"Đổi tên", remove:"Xóa", message:"Tin nhắn của bạn", send:"Gửi", stop:"Dừng",
    consent:"Lưu hội thoại vào tài khoản StartupBot của tôi và gửi các tin nhắn gần nhất cho nhà cung cấp AI.", confirm:"Xóa hội thoại này khỏi tài khoản?",
    you:"Bạn", bot:"StartupBot", empty:"Hội thoại mới", waiting:"Đang chờ StartupBot…", running:"Đang trả lời", limited:"Đã đạt giới hạn độ dài",
    interrupted:"Phản hồi bị gián đoạn. Kiểm tra hội thoại trước khi gửi lại.", delivered:"Hãy kiểm tra email để lấy mã.",
    personal_credit_exhausted:"Tài khoản đã hết hạn mức AI khả dụng.", account_rate_limit:"Có quá nhiều yêu cầu. Vui lòng thử lại sau.",
    managed_budget_exhausted:"Đã dùng hết ngân sách AI dùng chung.", managed_ai_paused:"AI đang tạm dừng.", signed_out:"Hãy đăng nhập để tiếp tục.",
    desktop_required:"Tác vụ này cần máy tính. Mở Kết nối máy tính trong StartupBot. Chưa có tác vụ nào được thực hiện.",
    thread_full:"Hãy mở hội thoại mới để tiếp tục.", history_full:"Hãy xóa một hội thoại để có chỗ trống.", error:"Chưa hoàn tất yêu cầu. Hãy kiểm tra kết nối và thử lại.",
    unavailable:"Dịch vụ tài khoản tạm thời gián đoạn.", account_changed:"Tài khoản đã thay đổi. Hãy mở lại hội thoại.", invalid_message:"Hãy rút ngắn tin nhắn và xác nhận lựa chọn lưu trữ."
  },
  pt: {
    skill:"O que deseja fazer?", ask:"Fazer uma pergunta", write:"Escrever", translate:"Traduzir", summarize:"Resumir", desktop:"Trabalhar no computador", copy:"Copiar", retry:"Reconectar", managed_access_revoked:"Acesso à IA suspenso.", email:"Endereço de e-mail", otp:"Código de oito dígitos", code:"Continuar com e-mail", login:"Entrar", change:"Alterar e-mail", logout:"Sair",
    history:"Conversas", new:"Nova conversa", rename:"Renomear", remove:"Excluir", message:"Sua mensagem", send:"Enviar", stop:"Parar",
    consent:"Salvar esta conversa na minha conta StartupBot e enviar as mensagens recentes ao provedor de IA.", confirm:"Excluir esta conversa da conta?",
    you:"Você", bot:"StartupBot", empty:"Nova conversa", waiting:"Aguardando o StartupBot…", running:"Resposta em andamento", limited:"Limite de resposta atingido",
    interrupted:"Resposta interrompida. Confira a conversa antes de reenviar.", delivered:"Confira seu e-mail para obter o código.",
    personal_credit_exhausted:"Sua conta está sem crédito de IA.", account_rate_limit:"Muitas solicitações. Tente mais tarde.",
    managed_budget_exhausted:"O orçamento compartilhado de IA foi atingido.", managed_ai_paused:"A IA está pausada.", signed_out:"Entre para continuar.",
    desktop_required:"Esta ação precisa de um computador conectado. Abra Conectar computador no StartupBot. Nenhuma ação foi executada.",
    thread_full:"Inicie uma nova conversa.", history_full:"Exclua uma conversa para liberar espaço.", error:"Falha na solicitação. Verifique a conexão e tente novamente.",
    unavailable:"O serviço de contas está temporariamente indisponível.", account_changed:"Sua conta mudou. Reabra a conversa.", invalid_message:"Reduza a mensagem e confirme o armazenamento."
  }
};
const locale = (new URLSearchParams(location.search).get("lang") || navigator.language).split(/[-_]/)[0];
const t = translations[locale] || translations.en;
document.documentElement.lang = translations[locale] ? locale : "en";
const el = id => document.getElementById(id);
for (const node of document.querySelectorAll("[data-t]")) node.textContent = t[node.dataset.t];
let account, thread, busy = false, active, pending;
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("startupbot-account") : null;
channel?.addEventListener("message", () => location.reload());
window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
window.addEventListener("pagehide", () => { active?.abort(); el("chat").hidden = true; el("transcript").replaceChildren(); });
function status(message = "") { el("status").textContent = message; }
function signedOut() {
  pending = undefined;
  account = undefined;
  thread = undefined;
  el("chat").hidden = el("logout").hidden = true;
  el("login").hidden = false;
  el("codeBox").hidden = el("changeEmail").hidden = true;
  el("otp").required = false;
  el("email").readOnly = false;
  el("loginButton").textContent = t.code;
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
    const code = (await response.json()).error?.code;
    if (response.status === 401 && path !== "login") signedOut();
    if (code === "request_exists") { await show(thread); pending = undefined; }
    if (code === "account_changed") location.reload();
    throw Error(code === "request_exists" ? t.interrupted : t[code] || (code === "account_unavailable" ? t.unavailable : t.error));
  }
  return response;
}
async function list() {
  const data = await (await api("threads")).json();
  if (account && account !== data.account) { location.reload(); return; }
  account = data.account;
  const options = data.threads.map(item => new Option(item.title, item.id));
  el("threads").replaceChildren(new Option(t.empty, ""), ...options);
  el("threads").value = options.some(o => o.value === thread) ? thread : "";
  return data.threads;
}
function bubble(speaker, text) {
  const block = document.createElement("article"), label = document.createElement("strong"), paragraph = document.createElement("p");
  label.textContent = speaker;
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
      code.textContent = part.replace(/^\n/, "");
      pre.append(code);
      fragment.append(pre);
    } else {
      for (const line of part.split("\n")) {
        const node = document.createElement(/^#{1,3} /.test(line) ? "strong" : "span");
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
  copy.textContent = t.copy;
  copy.onclick = () => navigator.clipboard.writeText(text).catch(() => status(t.error));
  element.parentElement.append(copy);
}
async function show(id) {
  thread = id || crypto.randomUUID();
  el("transcript").replaceChildren();
  el("compose").reset();
  el("threads").value = id || "";
  if (!id) return;
  const { turns } = await (await api("history", { thread })).json();
  for (const turn of turns) {
    bubble(t.you, turn.prompt);
    const answer = bubble(t.bot, "");
    if (turn.answer) formatAnswer(answer, turn.answer);
    if (t[turn.state]) answer.append(document.createTextNode(t[turn.state]));
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
  try { await work(); } catch (error) { status(error.name === "AbortError" ? t.interrupted : error.message === "Failed to fetch" ? t.error : error.message); }
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
      el("loginButton").textContent = t.login;
      el("otp").focus();
      status(t.delivered);
    } else {
      await api("login", { email, otp:el("otp").value });
      el("otp").value = "";
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
  const title = window.prompt(t.rename, el("threads").selectedOptions[0].textContent);
  if (title?.trim()) { await api("rename", { thread, title }); await list(); }
});
el("remove").onclick = () => action(async () => {
  if (el("threads").value && window.confirm(t.confirm)) { await api("delete", { thread }); await list(); await show(""); }
});
el("stop").onclick = () => active?.abort();
el("compose").onsubmit = event => {
  event.preventDefault();
  action(async () => {
    const prompt = el("prompt").value.trim();
    if (!prompt) return;
    if (!pending || pending.thread !== thread || pending.prompt !== prompt) pending = { thread, prompt, id:crypto.randomUUID() };
    const id = pending.id;
    const skill = el("skill").value;
    active = new AbortController();
    el("stop").hidden = false;
    status(t.waiting);
    try {
      const response = await api("send", { thread, id, prompt, runtime:skill === "desktop" ? "desktop" : "text", skill, save:el("consent").checked }, active.signal);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      el("prompt").value = "";
      bubble(t.you, prompt);
      const answer = bubble(t.bot, "");
      let buffer = "", state;
      while (true) {
        const chunk = await reader.read();
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
      status(state === "complete" ? "" : t[state] || t.interrupted);
    } finally {
      el("stop").hidden = true;
      active = undefined;
      if (account) await list().catch(() => { el("retry").hidden = false; });
    }
  });
};
action(openChat);
