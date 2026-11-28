import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import type { ZaloPeriodView, ZaloReportSchedule } from "../../shared/zalo-period-report";

const route = "/api/zalo-official/reports";
const changed = "omb:zalo-period-reports";
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const stamp = (value: number, timeZone: string) => new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "short", timeStyle: "short" }).format(value);

export function ZaloPeriodReports({ manage = false }: { manage?: boolean }) {
  const [view, setView] = useState<ZaloPeriodView | null>(null);
  const [form, setForm] = useState<ZaloReportSchedule>(() => ({ cadence: "daily", hour: 17, minute: 0, timeZone: timezone() }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { controller.abort(); pending.current?.abort(); pending.current = null; setView(null); setBusy(false); setRefresh(value => value + 1); };
    const load = async (first: boolean) => {
      try {
        const result = await api<{ view: ZaloPeriodView | null }>(route, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setView(result.view);
        if (!result.view) return;
        if (first && result.view.schedule) setForm(result.view.schedule);
        timer = setTimeout(() => void load(false), 30_000);
      } catch { if (!controller.signal.aborted) setView(null); }
    };
    void load(true);
    window.addEventListener(changed, invalidate);
    window.addEventListener("focus", invalidate);
    return () => { controller.abort(); pending.current?.abort(); clearTimeout(timer); window.removeEventListener(changed, invalidate); window.removeEventListener("focus", invalidate); };
  }, [manage, refresh]);
  async function save(schedule: ZaloReportSchedule | null) {
    if (!view || pending.current) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError(false);
    try {
      await api(route, { method: "POST", body: JSON.stringify({ schedule, revision: view.revision }), signal: controller.signal });
      if (!controller.signal.aborted) window.dispatchEvent(new Event(changed));
    } catch {
      if (!controller.signal.aborted) { setError(true); setView(null); setRefresh(n => n + 1); }
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setBusy(false); }
    }
  }
  if (!view || (!manage && !view.schedule && !view.periods.length)) return null;
  return <section className="grid gap-2 border-t border-hairline p-3 text-sm" aria-label={t("zalo.period.title")}>
    <h3 className="font-medium">{t("zalo.period.title")}</h3>
    <p>{t("zalo.period.source", view.source)}</p><p>{t("zalo.period.scope")}</p>
    {manage && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void save(form); }}>
      <label>{t("zalo.period.cadence")} <select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value === "hourly" ? "hourly" : "daily" })}>
        <option value="daily">{t("zalo.period.daily")}</option><option value="hourly">{t("zalo.period.hourly")}</option></select></label>
      {form.cadence === "daily" && <label>{t("zalo.period.hour")} <input required type="number" min="0" max="23" value={form.hour} onChange={e => setForm({ ...form, hour: Number(e.target.value) })} /></label>}
      <label>{t("zalo.period.minute")} <input required type="number" min="0" max="59" value={form.minute} onChange={e => setForm({ ...form, minute: Number(e.target.value) })} /></label>
      <label>{t("zalo.period.zone")} <input required maxLength={100} value={form.timeZone} onChange={e => setForm({ ...form, timeZone: e.target.value })} /></label>
      <button className="ui-button" disabled={busy}>{t("zalo.period.save")}</button>
      {view.schedule && <button type="button" className="ui-button" disabled={busy} onClick={() => void save(null)}>{t("zalo.period.stop")}</button>}
    </form>}
    {error && <p role="alert">{t("zalo.period.error")}</p>}
    {view.schedule && view.next !== null && <p>{t("zalo.period.next", { at: stamp(view.next, view.schedule.timeZone), zone: view.schedule.timeZone })}</p>}
    <ol className="grid gap-2">{view.periods.map(period => <li key={period.end}>
      <p>{stamp(period.start, period.timeZone)} – {stamp(period.end, period.timeZone)} ({period.timeZone})</p>
      <p>{t("zalo.period.result", { count: period.count, examined: period.examined, urgent: period.urgent, gaps: period.gaps })}</p>
    </li>)}</ol>
  </section>;
}
