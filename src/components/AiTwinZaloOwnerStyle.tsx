import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { localStyleExample, ZALO_OWNER_STYLE_PATH, type ApprovedOwnerStyle, type OwnerStyleTrait } from "../../shared/zalo-owner-style";
import type { AiTwinProfile } from "../../shared/ai-twin";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { SETTINGS_INPUT, SettingsField } from "./SettingsPrimitives";

const options = { mode: "same-origin", cache: "no-store", redirect: "error", timeoutMs: 8_000 } as const;
interface Proposal { proposalId: string; expires: number; traits: OwnerStyleTrait[] }

function Editor({ twin, refresh }: { twin: AiTwinProfile; refresh: () => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const active = useRef<AbortController | null>(null);
  const [approved, setApproved] = useState<ApprovedOwnerStyle | null>(null);
  const [proposal, setProposal] = useState<Proposal>();
  const [traits, setTraits] = useState<OwnerStyleTrait[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [issue, setIssue] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    void api<{ id: string; revision: number; approved: ApprovedOwnerStyle | null }>(ZALO_OWNER_STYLE_PATH, { ...options, signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        if (value.id !== twin.id || value.revision !== twin.revision) throw Error();
        setApproved(value.approved); setReady(true);
      }).catch(() => { if (!controller.signal.aborted) setIssue(true); }).finally(() => {
        if (!controller.signal.aborted) { active.current = null; setBusy(false); }
      });
    return () => { controller.abort(); active.current?.abort(); };
  }, [twin.id, twin.revision]);
  useEffect(() => {
    if (!proposal) return;
    const timer = window.setTimeout(() => { setProposal(undefined); setTraits([]); }, Math.max(0, proposal.expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [proposal]);

  async function submit(body: Record<string, unknown>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setIssue(false);
    try {
      const result = await api<Proposal | { ok: true }>(ZALO_OWNER_STYLE_PATH, { ...options, method: "POST", signal: controller.signal,
        body: JSON.stringify({ id: twin.id, revision: twin.revision, ...body }) });
      if (controller.signal.aborted) return;
      if ("proposalId" in result) { setProposal(result); setTraits(result.traits); }
      else { setProposal(undefined); setTraits([]); if (body.action !== "decline") refresh(); }
    } catch { if (!controller.signal.aborted) { setProposal(undefined); setTraits([]); setIssue(true); } }
    finally { if (!controller.signal.aborted) { active.current = null; setBusy(false); } }
  }
  function propose(event: FormEvent) {
    event.preventDefault();
    if (!consent || !field.current || busy) return;
    const sample = field.current.value; field.current.value = "";
    setConsent(false);
    void submit({ action: "propose", provenance: "owner-desktop-editor", authorConsent: true, sample });
  }

  return <div className="grid gap-2 text-sm" aria-busy={busy}>
    {issue && <div role="alert">{t("zaloStyle.error")} <button type="button" className="ui-button" onClick={refresh}>{t("common.tryAgain")}</button></div>}
    {approved && <div className="grid gap-1">
      <p>{t("zaloStyle.saved")}</p>
      <ul>{approved.traits.map(trait => <li key={trait}>{t(`zaloStyle.${trait}`)}</li>)}</ul>
      {!twin.paused && <><p>{t("zaloStyle.localExample")}</p><blockquote className="whitespace-pre-wrap">{localStyleExample(approved.traits)}</blockquote></>}
      <button type="button" disabled={busy} className="ui-button justify-self-start" onClick={() => void submit({ action: "forget" })}>{t("zaloStyle.forget")}</button>
    </div>}
    {ready && !twin.paused && !proposal && <form className="grid gap-2" onSubmit={propose} autoComplete="off">
      <SettingsField label={t("zaloStyle.input")} hint={t("zaloStyle.scope")}>
        <textarea ref={field} required minLength={12} maxLength={750} rows={3} spellCheck={false}
          onPaste={e => e.preventDefault()} onDrop={e => e.preventDefault()} className={SETTINGS_INPUT} />
      </SettingsField>
      <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        {t("zaloStyle.attest")}</label>
      <button type="submit" className="ui-button justify-self-start" disabled={busy || !consent}>{t("zaloStyle.propose")}</button>
    </form>}
    {proposal && <fieldset disabled={busy} className="grid gap-2">
      <legend>{t("zaloStyle.review")}</legend>
      {proposal.traits.map(trait => <label key={trait} className="flex gap-2">
        <input type="checkbox" checked={traits.includes(trait)} onChange={e => setTraits(others => e.target.checked ? [...others, trait] : others.filter(t => t !== trait))} />
        {t(`zaloStyle.${trait}`)}</label>)}
      <div className="flex gap-2">
        <button type="button" disabled={!traits.length} className="ui-button" onClick={() => void submit({ action: "approve", proposalId: proposal.proposalId, approveConsent: true, traits })}>{t("zaloStyle.approve")}</button>
        <button type="button" className="ui-button" onClick={() => void submit({ action: "decline", proposalId: proposal.proposalId })}>{t("zaloStyle.decline")}</button>
      </div>
    </fieldset>}
  </div>;
}

export function AiTwinZaloOwnerStyle(props: { twin: AiTwinProfile; refresh: () => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <section className="grid gap-2">
    <button type="button" className="ui-button justify-self-start" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(v => !v)}>{t("zaloStyle.title")}</button>
    <div id={id} hidden={!open} className={open ? "contents" : undefined}>
      {open && <Editor key={props.twin.id + ":" + props.twin.revision + ":" + attempt} twin={props.twin}
        refresh={() => { setAttempt(n => n + 1); props.refresh(); }} />}
    </div>
  </section>;
}
