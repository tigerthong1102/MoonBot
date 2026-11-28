import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ZaloReplyPreview, ZaloReplySource } from "../../shared/zalo-approved-send";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";

const path = "/api/zalo-official/reply";
const request = { mode: "same-origin", cache: "no-store", redirect: "error", timeoutMs: 15_000 } as const;
const statusKeys = {
  unknown: "zaloSend.unknown", acknowledged: "zaloSend.acknowledged", changed: "zaloSend.changed",
  "identity-failed": "zaloSend.identityFailed", unavailable: "zaloSend.unavailable", empty: "zaloSend.empty",
} as const;

export function ZaloApprovedReply() {
  const pending = useRef<AbortController | null>(null);
  const secret = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ZaloReplySource>();
  const [preview, setPreview] = useState<ZaloReplyPreview>();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<keyof typeof statusKeys>();
  const [receipt, setReceipt] = useState<string>();
  const [busy, setBusy] = useState(false);
  function clear() { setSource(undefined); setPreview(undefined); setText(""); setReceipt(undefined); }
  useEffect(() => {
    function hide() {
      if (document.visibilityState === "hidden") {
        pending.current?.abort(); pending.current = null;
        clear(); setBusy(false); setNotice(undefined);
      }
    }
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); pending.current?.abort(); };
  }, []);
  useEffect(() => {
    const until = preview?.expires ?? source?.sourceExpires;
    if (!until) return;
    const timer = window.setTimeout(() => { clear(); setNotice("changed"); }, Math.max(0, Math.min(300_000, until - Date.now())));
    return () => window.clearTimeout(timer);
  }, [source, preview]);

  async function run(operation: (signal: AbortSignal) => Promise<void>, sending = false) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setNotice(undefined);
    try { await operation(controller.signal); }
    catch { if (!controller.signal.aborted) { clear(); setNotice(sending ? "unknown" : "unavailable"); } }
    finally { if (pending.current === controller) pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  function read() {
    void run(async signal => {
      clear();
      const value = await api<{ source: ZaloReplySource | null }>(path, { ...request, signal });
      if (signal.aborted) return;
      if (!value.source || value.source.sourceExpires <= Date.now()) return setNotice("empty");
      setSource(value.source); setReceipt(value.source.receiptId); setNotice(value.source.accountHeld ? "unknown" : value.source.delivery);
    });
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!source || !text.trim()) return;
    void run(async signal => {
      const value = await api<ZaloReplyPreview>(path, { ...request, signal, method: "POST",
        body: JSON.stringify({ action: "preview", grantId: source.grantId, sourceId: source.sourceId, text }) });
      if (signal.aborted) return;
      if (value.text !== text || value.source?.grantId !== source.grantId || value.source.sourceId !== source.sourceId ||
          value.source.accountId !== source.accountId || value.source.senderId !== source.senderId ||
          value.source.conversationId !== source.conversationId || !value.digest || value.expires <= Date.now()) throw Error();
      setPreview(value); setSource(value.source);
    });
  }
  function send(event: FormEvent) {
    event.preventDefault();
    const token = secret.current?.value.trim();
    if (secret.current) secret.current.value = "";
    if (!token || !preview || preview.expires <= Date.now()) return;
    const approved = preview;
    void run(async signal => {
      clear();
      const result = await api<{ status: "acknowledged" | "unknown" | "changed" | "identity-failed"; receiptId?: string }>(
        path, { ...request, signal, method: "POST", body: JSON.stringify({
          action: "send", approvedByOwner: true, token, grantId: approved.source.grantId, sourceId: approved.source.sourceId,
          actionId: approved.actionId, digest: approved.digest, text: approved.text,
        }) });
      if (signal.aborted) return;
      setNotice(Object.hasOwn(statusKeys, result.status) ? result.status : "unknown");
      if (result.status === "acknowledged") setReceipt(result.receiptId);
    }, true);
  }

  return <section className="mt-2 grid gap-2 border-t border-hairline pt-3 text-sm" aria-busy={busy}>
    <h5 className="font-medium">{t("zaloSend.title")}</h5>
    <button type="button" className="ui-button justify-self-start" disabled={busy} onClick={read}>{t("zaloSend.open")}</button>
    {notice && <p role="status">{t(statusKeys[notice])}</p>}
    {receipt && <p>{t("zaloSend.receipt", { id: receipt })}</p>}
    {source && <div className="grid gap-1">
      <p>{t("zaloSend.destination", { bot: source.accountId, sender: source.senderId, chat: source.conversationId })}</p>
      <p>{t("zaloSend.source", { id: source.sourceId, time: new Date(source.sourceTime).toLocaleString() })}</p>
      <blockquote className="whitespace-pre-wrap break-words border-s-2 border-hairline ps-2">{source.sourceText}</blockquote>
    </div>}
    {source && !source.delivery && !source.accountHeld && !preview && <form onSubmit={prepare} className="grid gap-2">
      <label className="grid gap-1">{t("zaloSend.draft")}
        <textarea className="rounded-md border border-hairline bg-card p-2" maxLength={2000} required value={text}
          disabled={busy} onChange={e => setText(e.target.value)} /></label>
      <button className="ui-button justify-self-start" type="submit" disabled={busy || !text.trim()}>{t("zaloSend.preview")}</button>
    </form>}
    {preview && <form onSubmit={send} autoComplete="off" className="grid gap-2">
      <p>{t("zaloSend.review")}</p>
      <pre className="whitespace-pre-wrap break-words rounded border border-hairline p-2">{preview.text}</pre>
      <p>{t("zaloSend.expires", { time: new Date(preview.expires).toLocaleString(), id: preview.actionId })}</p>
      <label className="grid gap-1">{t("zaloOfficial.token")}<input type="password" ref={secret} autoComplete="off" spellCheck={false}
        maxLength={289} required className="rounded-md border border-hairline bg-card px-2 py-1" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-button" onClick={() => setPreview(undefined)}>{t("zaloSend.edit")}</button>
        <button type="submit" className="ui-button" disabled={busy}>{t("zaloSend.confirm")}</button>
      </div>
    </form>}
  </section>;
}
