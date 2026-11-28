const id = (value) => typeof value === "string" && /^[1-9][0-9]{0,31}$/.test(value);
const ignoreLateError = () => {};
const scopeKey = (kind, thread) => kind + "/" + thread;

export function normalizeText(accountId, allowed, message) {
  const kind = message?.type === 0 ? "direct" : message?.type === 1 ? "group" : undefined;
  if (!kind || !id(accountId) || !id(message.threadId) || !allowed.has(scopeKey(kind, message.threadId))) return null;
  const { data, isSelf } = message;
  if (!data || typeof isSelf !== "boolean" || data.msgType !== "webchat" || !id(data.msgId) || !id(data.uidFrom)) return null;
  if ((data.uidFrom === accountId) !== isSelf) return null;
  if (kind === "group" && data.idTo !== message.threadId) return null;
  if (kind === "direct" && (isSelf ? data.idTo !== message.threadId : data.uidFrom !== message.threadId || data.idTo !== accountId)) return null;
  if (typeof data.content !== "string" || !data.content.trim() || data.content.length > 8192) return null;
  if (typeof data.ts !== "string" || !/^\d{13}$/.test(data.ts)) return null;
  return {
    adapter: "personal", accountId, conversationId: message.threadId, conversationType: kind,
    messageId: data.msgId, senderId: data.uidFrom, timestamp: Number(data.ts), text: data.content,
    direction: isSelf ? "outgoing" : "incoming",
  };
}

// The owner supplies the expected platform identity and explicit conversation scope before listening.
export function createPersonalSessions() {
  const sessions = new Map();
  function begin({ accountId, conversations, client, onState, onQr, onMessage }) {
    if (!id(accountId) || !Array.isArray(conversations) || conversations.length > 512 ||
        conversations.some((c) => !id(c?.id) || !["direct", "group"].includes(c.type))) {
      throw new Error("invalid_scope");
    }
    if (sessions.has(accountId)) throw new Error("listener_conflict");
    const scope = new Set(conversations.map((c) => scopeKey(c.type, c.id)));
    const lease = Symbol();
    sessions.set(accountId, lease);
    let listener;
    const handlers = new Map();
    function listen(event, fn) {
      handlers.set(event, fn);
      listener.on(event, fn);
    }
    let abortLogin;
    let phase = "awaiting_qr";
    const active = () => sessions.get(accountId) === lease;
    const set = (next) => { phase = next; onState(next); };
    function stop(reason = "disconnected") {
      if (!active()) return;
      sessions.delete(accountId);
      scope.clear();
      try {
        abortLogin?.();
      } finally {
        try {
          if (listener) {
            for (const [event, fn] of handlers) listener.off(event, fn);
            handlers.clear();
            // Node EventEmitter throws on an unhandled asynchronous error during socket close.
            if (!listener.listeners("error").includes(ignoreLateError)) listener.on("error", ignoreLateError);
            listener.stop();
            listener = undefined;
          }
          abortLogin = undefined;
        } finally {
          set(reason);
        }
      }
    }
    function qr(event) {
      if (!active()) { event.actions?.abort(); return; }
      abortLogin = event.actions?.abort;
      if (event.type === 0) {
        const png = event.data?.image;
        if (typeof png !== "string" || png.length > 256_000 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png)) {
          stop("invalid_qr");
          return;
        }
        onQr(png);
      } else if (event.type === 1 || event.type === 3) {
        stop(event.type === 1 ? "qr_expired" : "qr_declined");
      } else if (event.type === 2) {
        set("awaiting_confirmation");
      }
    }
    set("awaiting_qr");
    const ready = (async () => {
      try {
        const api = await client.loginQR(undefined, qr);
        if (!active()) return;
        abortLogin = undefined;
        if (api.getOwnId() !== accountId) { stop("account_mismatch"); return; }
        listener = api.listener;
        listen("connected", () => { if (active()) set("listening"); });
        listen("message", (message) => {
          if (!active() || phase !== "listening") return;
          const text = normalizeText(accountId, scope, message);
          if (text) onMessage(text);
        });
        listen("closed", () => stop("coverage_unknown"));
        listen("error", () => stop("connector_error"));
        set("connecting");
        listener.start({ retryOnClose: false });
      } catch {
        stop("connector_error");
      }
    })();
    return { ready, stop: () => stop(), status: () => phase };
  }
  return { begin };
}
