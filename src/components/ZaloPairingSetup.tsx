import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ZaloPairingStatus } from "../../shared/zalo-pairing";
import { ZaloApprovedReply } from "./ZaloApprovedReply";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";

const endpoint = "/api/zalo-official/pairing";
const request = { mode: "same-origin", redirect: "error", cache: "no-store", timeoutMs: 8_000 } as const;
type Snapshot = ZaloPairingStatus & { command?: string };
const stamp = (time: number) => new Date(time).toLocaleString(document.documentElement.lang || undefined);

export function ZaloPairingSetup({ approvedSendPilot = false }: { approvedSendPilot?: boolean }) {
  const pending = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const [sender, setSender] = useState("");
  const [chat, setChat] = useState("");
  const [days, setDays] = useState("7");

  async function update(body?: object) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    setConfirmRevoke(false);
    setSender(""); setChat(""); setDays("7");
    setStatus(undefined);
    try {
      const value = await api<Snapshot>(endpoint, { ...request, signal: controller.signal,
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
      if (!["unconfigured", "ready", "waiting", "locked", "candidate", "paired"].includes(value.state) ||
          (value.state !== "unconfigured" && (!value.accountId || !value.revision)) ||
          (value.expires !== undefined && (!Number.isFinite(value.expires) || value.expires <= Date.now()))) throw Error("invalid-status");
      if (!controller.signal.aborted) setStatus(value);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    void update();
    return () => { pending.current?.abort(); pending.current = null; };
  }, []);
  useEffect(() => {
    if (!status?.expires) return;
    const timer = window.setTimeout(() => { void update(); }, Math.max(0, status.expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [status]);

  const candidate = status?.state === "candidate" ? status.participant : undefined;
  const canApprove = candidate && sender === candidate.senderId && chat === candidate.conversationId &&
    Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365;
  function approve(event: FormEvent) {
    event.preventDefault();
    if (canApprove) void update({ action: "approve", revision: status?.revision, senderId: sender, conversationId: chat, retentionDays: Number(days) });
  }

  return <section className="mt-4 grid gap-2 border-t border-hairline pt-3" aria-busy={busy}>
    <h4 className="text-sm font-medium text-ink">{t("zaloPair.title")}</h4>
    <p className="text-xs text-ink-secondary">{t("zaloPair.boundary")}</p>
    {failed && <p role="alert">{t("zaloPair.error")}</p>}
    {status && <div className="grid gap-2 text-sm" aria-live="polite">
      {status.accountId && <p>{t("zaloPair.account", { id: status.accountId })}</p>}
      <p>{t(({ unconfigured: "zaloPair.unconfigured", ready: "zaloPair.ready", waiting: "zaloPair.waiting",
        locked: "zaloPair.locked", candidate: "zaloPair.candidate", paired: "zaloPair.paired" } as const)[status.state])}</p>
      {status.command && <p><code className="select-all break-all">{status.command}</code></p>}
      {status.expires && <p>{t("zaloPair.expires", { time: stamp(status.expires) })}</p>}
      {status.participant && <dl className="grid gap-1">
        <div><dt>{t("zaloPair.sender")}</dt><dd className="select-all break-all">{status.participant.senderId}</dd></div>
        <div><dt>{t("zaloPair.chat")}</dt><dd className="select-all break-all">{status.participant.conversationId}</dd></div>
      </dl>}
      {candidate && <form onSubmit={approve} autoComplete="off" className="grid gap-2">
        <p>{t("zaloPair.match")}</p>
        <label className="grid">{t("zaloPair.confirmSender")}<input className="rounded-md border border-hairline bg-card px-2 py-1 text-ink" value={sender} maxLength={128} onChange={e => setSender(e.target.value)} required /></label>
        <label className="grid">{t("zaloPair.confirmChat")}<input className="rounded-md border border-hairline bg-card px-2 py-1 text-ink" value={chat} maxLength={128} onChange={e => setChat(e.target.value)} required /></label>
        <label className="grid">{t("zaloPair.days")}<input className="w-28 rounded-md border border-hairline bg-card px-2 py-1 text-ink" type="number" min={1} max={365} value={days} onChange={e => setDays(e.target.value)} required /></label>
        <button className="ui-button justify-self-start" type="submit" disabled={!canApprove}>{t("zaloPair.approve")}</button>
      </form>}
      {status.coverage && <>
        <p>{t("zaloPair.coverage", { count: status.coverage.count, days: status.retentionDays ?? 0 })}</p>
        {status.coverage.first !== null && status.coverage.last !== null && <p>{t("zaloPair.range", {
          first: stamp(status.coverage.first), last: stamp(status.coverage.last),
        })}</p>}
        <p>{t("zaloPair.gaps", { polls: status.coverage.pollGaps, issues: status.coverage.timingIssues })}</p>
      </>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <button className="ui-button" type="button" disabled={busy} onClick={() => void update()}>{t("zaloPair.refresh")}</button>
      {status?.revision && status.state !== "paired" && <button className="ui-button" type="button"
        onClick={() => void update({ action: "invite", revision: status.revision })}>{t(status.state === "ready" ? "zaloPair.invite" : "zaloPair.replace")}</button>}
      {status?.revision && !confirmRevoke && <button className="ui-button" type="button" onClick={() => setConfirmRevoke(true)}>{t("zaloPair.revoke")}</button>}
    </div>
    {approvedSendPilot && status?.state === "paired" && <ZaloApprovedReply key={status.revision} />}
    {confirmRevoke && status?.revision && <div className="grid gap-2 text-sm">
      <p>{t("zaloPair.deleteNotice")}</p>
      <div className="flex gap-2">
        <button className="ui-button" type="button" onClick={() => void update({ action: "revoke", revision: status.revision })}>{t("zaloPair.confirmRevoke")}</button>
        <button className="ui-button" type="button" onClick={() => setConfirmRevoke(false)}>{t("zaloPair.cancel")}</button>
      </div>
    </div>}
  </section>;
}
