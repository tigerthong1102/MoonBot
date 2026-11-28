let callback = location.pathname === "/mobile/callback" ? new URLSearchParams(location.search) : null;
if (callback) history.replaceState(null, "", "/mobile");
const translations = {
  en: {
    offline:"You’re offline. Your draft is still here.", online:"You’re back online. You can send your draft.", agreeSend:"Agree and send",
    shortNew:"New", menu:"Menu", menuTitle:"Conversations & account", close:"Close", welcome:"Chat with StartupBot", welcomeNote:"Continue with your email to save chats and open them on another device.", startChat:"How can I help?", options:"Chat options", placeholder:"Write your message…", writeHint:"What would you like to draft?", translateHint:"Paste the text and tell me the language.", summarizeHint:"Paste the text you want summarized.",
    currentSession:"Current session",
    usage:"AI credit and usage", balance:"Available StartupBot credit", byokUsage:"OpenRouter today (UTC), settled / awaiting cost", runtime_unavailable:"This action requires an unavailable runtime. No task has been started.", skill_paused:"This skill is paused.",
    sessions:"Account sessions", logoutAll:"Sign out everywhere", confirmAll:"Sign out of all StartupBot account sessions?", revoke:"Revoke session", confirmRevoke:"Revoke this session?", expires:"Expires", reauthenticate:"Sign out and verify your email again to manage sessions.", session_not_found:"This session has already ended.",
    older:"Earlier messages", campaign:"Plan a campaign", outreach:"Draft an outreach email", devices:"My registered computers", deviceNote:"Pair a computer in the StartupBot app to use its tools.", noDevices:"No registered computers.", providers:"AI provider", providerNote:"OpenRouter bills your own credits. Disconnecting removes this session’s key. You can revoke it in OpenRouter.", billing:"Pay for this conversation with", managed:"StartupBot credit", personal:"My OpenRouter credit", connectProvider:"Connect OpenRouter", disconnectProvider:"Disconnect", providerKeys:"Manage OpenRouter keys",
    provider_disconnected:"Reconnect your OpenRouter account to continue this conversation.", provider_conflict:"Start a new conversation to change the payer.", provider_daily_limit:"This account reached its personal-key safety limit.", provider_connection_failed:"OpenRouter could not complete the request. Check your key and credits.", provider_limit_required:"Connect a key with a positive credit limit.", invalid_callback:"The connection expired. Start again.",
    skill:"What would you like to do?", ask:"Ask a question", write:"Draft text", translate:"Translate", summarize:"Summarize text", desktop:"Work on my computer", copy:"Copy", retry:"Reconnect", managed_access_revoked:"AI access has been suspended.", email:"Email address", otp:"Eight-digit email code", code:"Continue with email", login:"Sign in", change:"Change email", logout:"Sign out",
    history:"Conversations", new:"New conversation", rename:"Rename", remove:"Delete", message:"Your message", send:"Send", stop:"Stop",
    consent:"StartupBot saves this chat. OpenRouter and its model provider receive your recent messages.", confirm:"Delete this conversation from your account?",
    you:"You", bot:"StartupBot", empty:"New conversation", waiting:"Waiting for StartupBot…", running:"Response in progress", limited:"Output limit reached",
    interrupted:"Response interrupted. Check the conversation before sending again.", delivered:"Check your email for the code.",
    personal_credit_exhausted:"Your account has no available AI credit.", account_rate_limit:"Too many requests. Try again later.",
    managed_budget_exhausted:"The shared AI budget has reached its limit.", managed_ai_paused:"AI is paused.", signed_out:"Sign in to continue.",
    desktop_required:"This action needs a connected computer. Open Connect computer in StartupBot. Nothing has been run.",
    thread_full:"Start a new conversation to continue.", history_full:"Delete a conversation to make room.", error:"Unable to complete the request. Check your connection and try again.",
    unavailable:"The account service is temporarily unavailable.", account_changed:"Your account changed. Reopen the conversation.", invalid_message:"Shorten your message and confirm the storage choice."
  },
  vi: {
    offline:"Đang ngoại tuyến. Nội dung bạn đang soạn vẫn còn ở đây.", online:"Đã có mạng. Bạn có thể gửi nội dung đang soạn.", agreeSend:"Đồng ý và gửi",
    shortNew:"Mới", menu:"Menu", menuTitle:"Hội thoại và tài khoản", close:"Đóng", welcome:"Trò chuyện với StartupBot", welcomeNote:"Tiếp tục bằng email để lưu hội thoại và mở lại trên thiết bị khác.", startChat:"Bạn muốn làm gì hôm nay?", options:"Tùy chọn chat", placeholder:"Nhập tin nhắn…", writeHint:"Bạn muốn soạn nội dung gì?", translateHint:"Dán đoạn văn và cho biết ngôn ngữ cần dịch.", summarizeHint:"Dán văn bản bạn muốn tóm tắt.",
    currentSession:"Phiên hiện tại",
    usage:"Số dư và mức sử dụng AI", balance:"Credit StartupBot có thể dùng", byokUsage:"OpenRouter hôm nay (UTC), đã tính / tạm giữ", runtime_unavailable:"Chưa có môi trường để chạy yêu cầu này. Chưa khởi chạy tác vụ.", skill_paused:"Skill này đang tạm ngưng.",
    sessions:"Phiên đăng nhập", logoutAll:"Đăng xuất mọi thiết bị", confirmAll:"Đăng xuất tài khoản StartupBot trên tất cả thiết bị?", revoke:"Thu hồi phiên", confirmRevoke:"Thu hồi phiên đăng nhập này?", expires:"Hết hạn", reauthenticate:"Hãy đăng xuất rồi xác minh lại email để quản lý phiên.", session_not_found:"Phiên này đã kết thúc.",
    older:"Tin nhắn trước", campaign:"Lập kế hoạch chiến dịch", outreach:"Soạn email tiếp cận khách hàng", devices:"Máy tính đã đăng ký", deviceNote:"Để sử dụng công cụ trên máy tính, hãy ghép nối trong ứng dụng StartupBot.", noDevices:"Chưa có máy tính đăng ký.", providers:"Nhà cung cấp AI", providerNote:"OpenRouter tính vào số dư riêng của bạn. Ngắt kết nối sẽ xóa khóa khỏi phiên này. Bạn có thể thu hồi khóa trên OpenRouter.", billing:"Chi trả cho hội thoại bằng", managed:"Credit StartupBot", personal:"Credit OpenRouter của tôi", connectProvider:"Kết nối OpenRouter", disconnectProvider:"Ngắt kết nối", providerKeys:"Quản lý khóa OpenRouter",
    provider_disconnected:"Hãy kết nối lại OpenRouter để tiếp tục hội thoại.", provider_conflict:"Hãy mở hội thoại mới để đổi bên chi trả.", provider_daily_limit:"Tài khoản đã đạt trần sử dụng khóa riêng.", provider_connection_failed:"OpenRouter chưa hoàn tất yêu cầu. Hãy kiểm tra khóa và số dư.", provider_limit_required:"Hãy kết nối khóa có hạn mức dương.", invalid_callback:"Phiên kết nối đã hết hạn. Hãy bắt đầu lại.",
    skill:"Bạn muốn làm gì?", ask:"Hỏi đáp", write:"Soạn nội dung", translate:"Dịch", summarize:"Tóm tắt văn bản", desktop:"Thao tác trên máy tính", copy:"Sao chép", retry:"Kết nối lại", managed_access_revoked:"Quyền sử dụng AI đã bị tạm ngưng.", email:"Địa chỉ email", otp:"Mã tám chữ số gửi qua email", code:"Tiếp tục bằng email", login:"Đăng nhập", change:"Đổi email", logout:"Đăng xuất",
    history:"Hội thoại", new:"Hội thoại mới", rename:"Đổi tên", remove:"Xóa", message:"Tin nhắn của bạn", send:"Gửi", stop:"Dừng",
    consent:"StartupBot lưu hội thoại. OpenRouter và bên chạy model sẽ nhận các tin nhắn gần nhất.", confirm:"Xóa hội thoại này khỏi tài khoản?",
    you:"Bạn", bot:"StartupBot", empty:"Hội thoại mới", waiting:"Đang chờ StartupBot…", running:"Đang trả lời", limited:"Đã đạt giới hạn độ dài",
    interrupted:"Phản hồi bị gián đoạn. Kiểm tra hội thoại trước khi gửi lại.", delivered:"Hãy kiểm tra email để lấy mã.",
    personal_credit_exhausted:"Tài khoản đã hết hạn mức AI khả dụng.", account_rate_limit:"Có quá nhiều yêu cầu. Vui lòng thử lại sau.",
    managed_budget_exhausted:"Đã dùng hết ngân sách AI dùng chung.", managed_ai_paused:"AI đang tạm dừng.", signed_out:"Hãy đăng nhập để tiếp tục.",
    desktop_required:"Tác vụ này cần máy tính. Mở Kết nối máy tính trong StartupBot. Chưa có tác vụ nào được thực hiện.",
    thread_full:"Hãy mở hội thoại mới để tiếp tục.", history_full:"Hãy xóa một hội thoại để có chỗ trống.", error:"Chưa hoàn tất yêu cầu. Hãy kiểm tra kết nối và thử lại.",
    unavailable:"Dịch vụ tài khoản tạm thời gián đoạn.", account_changed:"Tài khoản đã thay đổi. Hãy mở lại hội thoại.", invalid_message:"Hãy rút ngắn tin nhắn và xác nhận lựa chọn lưu trữ."
  },
  pt: {
    offline:"Você está offline. Seu rascunho continua aqui.", online:"Conexão restabelecida. Você pode enviar seu rascunho.", agreeSend:"Aceitar e enviar",
    shortNew:"Nova", menu:"Menu", menuTitle:"Conversas e conta", close:"Fechar", welcome:"Converse com o StartupBot", welcomeNote:"Continue com seu e-mail para salvar conversas e abri-las em outro dispositivo.", startChat:"Como posso ajudar?", options:"Opções da conversa", placeholder:"Escreva sua mensagem…", writeHint:"O que deseja escrever?", translateHint:"Cole o texto e indique o idioma.", summarizeHint:"Cole o texto que deseja resumir.",
    currentSession:"Sessão atual",
    usage:"Crédito e uso de IA", balance:"Crédito StartupBot disponível", byokUsage:"OpenRouter hoje (UTC), liquidado / pendente", runtime_unavailable:"O ambiente solicitado está indisponível. Nenhuma tarefa foi iniciada.", skill_paused:"Esta habilidade está pausada.",
    sessions:"Sessões da conta", logoutAll:"Sair de todos os dispositivos", confirmAll:"Sair de todas as sessões da conta StartupBot?", revoke:"Revogar sessão", confirmRevoke:"Revogar esta sessão?", expires:"Expira", reauthenticate:"Saia e verifique seu e-mail novamente para gerenciar sessões.", session_not_found:"Esta sessão já terminou.",
    older:"Mensagens anteriores", campaign:"Planejar campanha", outreach:"Escrever e-mail de prospecção", devices:"Computadores registrados", deviceNote:"Emparelhe um computador no app StartupBot para usar as ferramentas dele.", noDevices:"Nenhum computador registrado.", providers:"Provedor de IA", providerNote:"O OpenRouter cobra seus créditos. Desconectar remove a chave desta sessão. Revogue a chave no OpenRouter.", billing:"Pagar esta conversa com", managed:"Crédito StartupBot", personal:"Meu crédito OpenRouter", connectProvider:"Conectar OpenRouter", disconnectProvider:"Desconectar", providerKeys:"Gerenciar chaves OpenRouter",
    provider_disconnected:"Reconecte o OpenRouter para continuar.", provider_conflict:"Abra uma nova conversa para mudar o pagador.", provider_daily_limit:"Limite da chave pessoal atingido.", provider_connection_failed:"Confira a chave e o crédito no OpenRouter.", provider_limit_required:"Use uma chave com limite positivo.", invalid_callback:"Conexão expirada. Tente de novo.",
    skill:"O que deseja fazer?", ask:"Fazer uma pergunta", write:"Escrever", translate:"Traduzir", summarize:"Resumir", desktop:"Trabalhar no computador", copy:"Copiar", retry:"Reconectar", managed_access_revoked:"Acesso à IA suspenso.", email:"Endereço de e-mail", otp:"Código de oito dígitos", code:"Continuar com e-mail", login:"Entrar", change:"Alterar e-mail", logout:"Sair",
    history:"Conversas", new:"Nova conversa", rename:"Renomear", remove:"Excluir", message:"Sua mensagem", send:"Enviar", stop:"Parar",
    consent:"O StartupBot salva a conversa. O OpenRouter e o provedor do modelo recebem suas mensagens recentes.", confirm:"Excluir esta conversa da conta?",
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
let account, thread, busy = false, active, pending, connection;
let conversations = [], before, consentedThread, newThread;
const drafts = new Map();
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("startupbot-account") : null;
channel?.addEventListener("message", () => location.reload());
window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
window.addEventListener("pagehide", () => { active?.abort(); el("chat").hidden = true; el("transcript").replaceChildren(); });
function status(message = "") {
  el("status").textContent = message;
  el("menuStatus").textContent = el("menu").open ? message : "";
}
window.addEventListener("offline", () => status(t.offline));
window.addEventListener("online", () => { if (account && !active) status(t.online); });
function updateComposer() {
  const skill = el("skill").value;
  const title = el("skill").selectedOptions[0]?.textContent;
  el("prompt").placeholder = t[skill + "Hint"] || t.placeholder;
  el("options").querySelector("summary").textContent = skill === "chat" || !title ? t.options : title;
}
function scrollToLatest() {
  el("reading").scrollTop = el("reading").scrollHeight;
}
el("openMenu").onclick = () => el("menu").showModal();
el("closeMenu").onclick = () => el("menu").close();
el("skill").onchange = updateComposer;
for (const starter of document.querySelectorAll("[data-skill]")) {
  starter.onclick = () => {
    el("skill").value = starter.dataset.skill;
    updateComposer();
    el("prompt").focus();
  };
}
function signedOut() {
  if (el("menu").open) el("menu").close();
  el("chatNav").hidden = true;
  pending = undefined;
  newThread = undefined;
  drafts.clear();
  account = undefined;
  thread = undefined;
  consentedThread = undefined;
  conversations = [];
  connection = undefined;
  el("chat").hidden = el("logout").hidden = true;
  el("login").hidden = false;
  el("codeBox").hidden = el("changeEmail").hidden = true;
  el("otp").required = false;
  el("email").readOnly = false;
  el("loginButton").textContent = t.code;
  el("transcript").replaceChildren();
  el("usage").open = false;
  el("usageText").textContent = "";
  el("sessions").open = false;
  el("sessionList").replaceChildren();
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
  conversations = data.threads;
  if (conversations.some(item => item.id === newThread)) newThread = undefined;
  for (const id of drafts.keys()) {
    if (id !== newThread && !conversations.some(item => item.id === id)) drafts.delete(id);
  }
  connection = data.provider;
  for (const starter of document.querySelectorAll("[data-skill]")) starter.hidden = data.disabledSkills?.includes(starter.dataset.skill) ?? false;
  for (const option of el("skill").options) option.disabled = data.disabledSkills?.includes(option.value) ?? false;
  if (el("skill").selectedOptions[0]?.disabled) el("skill").value = [...el("skill").options].find(o => !o.disabled)?.value ?? "";
  el("providers").hidden = !connection?.enabled && !connection?.connected;
  el("connectProvider").hidden = !connection?.enabled || connection.connected;
  el("disconnectProvider").hidden = !connection?.connected;
  el("providerKeys").href = connection?.settingsURL || "https://openrouter.ai/keys";
  const options = data.threads.map(item => new Option(item.title, item.id));
  el("threads").replaceChildren(new Option(t.empty, ""), ...options);
  el("threads").value = options.some(o => o.value === thread) ? thread : "";
  payer();
  updateComposer();
  return data.threads;
}
function payer() {
  const saved = conversations.find(item => item.id === thread);
  el("billing").hidden = !connection?.connected && saved?.provider !== "openrouter";
  el("provider").disabled = Boolean(saved);
  if (saved) el("provider").value = saved.provider;
  el("provider").options[1].disabled = !connection?.connected;
}
function bubble(speaker, text, container = el("transcript")) {
  const block = document.createElement("article"), label = document.createElement("strong"), paragraph = document.createElement("p");
  block.className = speaker === t.you ? "user" : "assistant";
  label.textContent = speaker;
  paragraph.textContent = text;
  block.append(label, paragraph);
  container.append(block);
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
  consentedThread = undefined;
  el("consentNotice").hidden = false;
  el("send").textContent = t.agreeSend;
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
  el("intro").hidden = Boolean(id);
  el("options").open = false;
  updateComposer();
  if (id) {
    await loadHistory();
    scrollToLatest();
  }
}
async function loadHistory() {
  const { turns, next } = await (await api("history", { thread, before })).json();
  const reading = el("reading"), previousHeight = reading.scrollHeight;
  const fragment = document.createDocumentFragment();
  for (const turn of turns) {
    bubble(t.you, turn.prompt, fragment);
    const answer = bubble(t.bot, "", fragment);
    if (turn.answer) formatAnswer(answer, turn.answer);
    if (t[turn.state]) answer.append(document.createTextNode(t[turn.state]));
  }
  el("transcript").prepend(fragment);
  if (before) reading.scrollTop += reading.scrollHeight - previousHeight;
  before = next;
  el("older").hidden = !before;
}
function lock(value) {
  busy = value;
  for (const id of ["openMenu","threads","new","older","rename","remove","send","logout","logoutAll","loginButton","changeEmail","connectProvider","disconnectProvider"]) el(id).disabled = value;
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
  el("chat").hidden = el("logout").hidden = el("chatNav").hidden = false;
  el("login").hidden = true;
  const existing = threads.some(item => item.id === thread) ? thread : threads[0]?.id;
  try { await show(thread === newThread && newThread ? "" : existing || ""); }
  catch (error) { el("retry").hidden = false; throw error; }
  if (callback) {
    const authorization = callback;
    callback = null;
    await api("provider/complete", { code:authorization.get("code"), state:authorization.get("state") });
    await list();
    el("menu").showModal();
    el("providers").open = true;
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
      el("loginButton").textContent = t.login;
      el("otp").focus();
      status(t.delivered);
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
    el("usageText").textContent = [t.balance + " · " + usd(usage.available),
      usage.expires && t.expires + " · " + new Date(usage.expires).toLocaleDateString(locale),
      t.byokUsage + " · " + usd(usage.byokTodayUTC.settled) + " / " + usd(usage.byokTodayUTC.pending)].filter(Boolean).join("\n");
  } catch (error) { status(error.message); }
};
async function showSessions() {
  const initiatingAccount = account;
  const { sessions } = await (await api("sessions", {})).json();
  if (!account || account !== initiatingAccount || !el("sessions").open) return;
  const items = sessions.map(session => {
    const item = document.createElement("li"), button = document.createElement("button");
    if (session.current) item.append(t.currentSession + " · ");
    item.append(new Date(session.createdAt).toLocaleString(locale) + " · " + t.expires + " " + new Date(session.expiresAt).toLocaleString(locale) + " ");
    button.textContent = t.revoke;
    button.onclick = () => action(async () => {
      if (!window.confirm(t.confirmRevoke)) return;
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
  if (!window.confirm(t.confirmAll)) return;
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
    el("deviceList").replaceChildren(...(devices.length ? devices.map(d => [d.name, d.platform, d.appVersion].filter(Boolean).join(" · ")) : [t.noDevices])
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
el("threads").onchange = () => action(async () => { await show(el("threads").value); el("menu").close(); });
el("older").onclick = () => action(loadHistory);
el("new").onclick = () => action(() => show(""));
el("rename").onclick = () => action(async () => {
  if (!el("threads").value) return;
  const title = window.prompt(t.rename, el("threads").selectedOptions[0].textContent);
  if (title?.trim()) { await api("rename", { thread, title }); await list(); }
});
el("remove").onclick = () => action(async () => {
  if (el("threads").value && window.confirm(t.confirm)) {
    await api("delete", { thread });
    drafts.delete(thread);
    thread = pending = undefined;
    await list();
    await show("");
    el("menu").close();
  }
});
el("stop").onclick = () => active?.abort();
el("compose").onsubmit = event => {
  event.preventDefault();
  if (!navigator.onLine) { status(t.offline); return; }
  const authorized = consentedThread === thread || event.submitter === el("send");
  if (!authorized) return;
  action(async () => {
    const prompt = el("prompt").value.trim();
    if (!prompt) return;
    if (!pending || pending.thread !== thread || pending.prompt !== prompt) pending = { thread, prompt, id:crypto.randomUUID() };
    const id = pending.id;
    const skill = el("skill").value;
    active = new AbortController();
    el("stop").hidden = false;
    el("send").hidden = true;
    status(t.waiting);
    try {
      const response = await api("send", { thread, id, prompt, provider:el("provider").value, runtime:skill === "desktop" ? "desktop" : "text", skill, save:authorized }, active.signal);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      consentedThread = thread;
      el("consentNotice").hidden = true;
      el("send").textContent = t.send;
      if (el("prompt").value.trim() === prompt) el("prompt").value = "";
      el("intro").hidden = true;
      bubble(t.you, prompt);
      const answer = bubble(t.bot, "");
      scrollToLatest();
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
            const reading = el("reading");
            const follow = reading.scrollHeight - reading.clientHeight - reading.scrollTop < 64;
            answer.append(document.createTextNode(frame.text));
            if (follow) scrollToLatest();
            status();
          }
          if (frame.state) state = frame.state;
        }
      }
      if (answer.textContent) formatAnswer(answer, answer.textContent);
      pending = undefined;
      status(state === "complete" ? "" : t[state] || t.interrupted);
    } finally {
      el("stop").hidden = true;
      el("send").hidden = false;
      active = undefined;
      if (account) await list().catch(() => { el("retry").hidden = false; });
    }
  });
};
action(openChat);
