import { useEffect, useRef, useState } from "react";
import type { ZaloPairingStatus } from "../../shared/zalo-pairing";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";

type Coverage = NonNullable<ZaloPairingStatus["coverage"]>;
type Preview = { start: number; end: number; count: number; confirmation: string };
const path = "/api/zalo-official/erasure";

export function localDayInterval(first: string, last: string, now = Date.now()) {
  function midnight(value: string) {
    if (!/^\d{4}-\d\d-\d\d$/.test(value)) return;
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
  }
  const start = midnight(first), end = midnight(last);
  if (!start || !end || +start < 0 || +start > +end || +end > now) return;
  end.setDate(end.getDate() + 1);
  return { start: +start, end: Math.min(+end - 1, now) };
}

export function ZaloSourceErasure({ revision, onErased }: { revision: string; onErased(coverage: Coverage): void }) {
  const [first, setFirst] = useState(""), [last, setLast] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [deleted, setDeleted] = useState<number>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  function reset() { setPreview(undefined); setDeleted(undefined); setFailed(false); }

  async function submit(erase: boolean) {
    const range = erase ? preview : localDayInterval(first, last);
    if (pending.current || !range || (erase && !preview?.count)) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    reset();
    const { start, end } = range;
    const request = { method: "POST", mode: "same-origin", redirect: "error", cache: "no-store",
      signal: controller.signal, timeoutMs: 10_000 } as const;
    try {
      if (erase) {
        const result = await api<{ erased: number; coverage: Coverage }>(path, { ...request,
          body: JSON.stringify({ action: "erase", revision, start, end, confirmation: preview!.confirmation }) });
        if (!controller.signal.aborted) { onErased(result.coverage); setDeleted(result.erased); }
      } else {
        const result = await api<{ count: number; confirmation: string }>(path, { ...request,
          body: JSON.stringify({ action: "preview", revision, start, end }) });
        if (!controller.signal.aborted) setPreview({ ...result, start, end });
      }
    } catch { if (!controller.signal.aborted) setFailed(true); }
    finally { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <fieldset className="grid gap-2 rounded-lg border border-hairline p-3" disabled={busy}>
    <legend>{t("zaloErase.title")}</legend>
    <p className="text-xs text-ink-secondary">{t("zaloErase.boundary")}</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid">{t("zaloErase.first")}<input type="date" value={first} onChange={e => { reset(); setFirst(e.target.value); }} /></label>
      <label className="grid">{t("zaloErase.last")}<input type="date" value={last} min={first} onChange={e => { reset(); setLast(e.target.value); }} /></label>
      <button type="button" className="ui-button" disabled={!localDayInterval(first, last)} onClick={() => void submit(false)}>{t("zaloErase.preview")}</button>
    </div>
    {preview && <div className="grid gap-2" role="status">
      <p>{t("zaloErase.matches", { count: preview.count })}</p>
      {preview.count > 0 && <div className="flex gap-2">
        <button type="button" className="ui-button" onClick={() => void submit(true)}>{t("zaloErase.confirm")}</button>
        <button type="button" className="ui-button" onClick={reset}>{t("zaloPair.cancel")}</button>
      </div>}
    </div>}
    {deleted !== undefined && <p role="status">{t("zaloErase.done", { count: deleted })}</p>}
    {failed && <p role="alert">{t("zaloErase.error")}</p>}
  </fieldset>;
}
