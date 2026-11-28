import { Select } from "./Select";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { ApiError, api } from "@/state/api";
import { reportTimeZone, type ZaloPeriodView, type ZaloReportSchedule } from "../../shared/zalo-period-report";

const route = "/api/zalo-official/reports";
const changed = "omb:zalo-period-reports";
const defaultSchedule = (): ZaloReportSchedule => ({ cadence: "daily", hour: 17, minute: 0, timeZone: reportTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC" });
const stamp = (value: number, timeZone: string) => new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "short", timeStyle: "short" }).format(value);

export function ZaloPeriodReports({ manage = false }: { manage?: boolean }) {
  const [view, setView] = useState<ZaloPeriodView | null>(null);
  const [form, setForm] = useState<ZaloReportSchedule>(defaultSchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: string | undefined;
    const invalidate = () => { controller.abort(); pending.current?.abort(); pending.current = null; setView(null); setBusy(false); setRefresh(value => value + 1); };
    let request = 0;
    const load = async (first = false) => {
      const latest = ++request;
      clearTimeout(timer);
      try {
        const result = await api<{ view: ZaloPeriodView | null }>(route, { signal: controller.signal });
        if (controller.signal.aborted || latest !== request) return;
        if (manage && !first && revision !== undefined && result.view?.revision !== revision) {
          setView(null); setError(true); return;
        }
        const initialize = revision === undefined;
        revision = result.view?.revision;
        setView(result.view);
        if (!result.view) return;
        if (first || initialize) setForm(result.view.schedule ?? defaultSchedule());
        timer = setTimeout(() => void load(), 30_000);
      } catch (cause) {
        if (controller.signal.aborted || latest !== request) return;
        setView(null);
        if (!(cause instanceof ApiError && [401, 403].includes(cause.status))) timer = setTimeout(() => void load(), 30_000);
      }
    };
    void load(true);
    const focused = () => { void load(); };
    window.addEventListener(changed, invalidate);
    window.addEventListener("startupbot-zalo-scope-changed", invalidate);
    window.addEventListener("focus", focused);
    return () => {
      controller.abort(); pending.current?.abort(); clearTimeout(timer);
      window.removeEventListener(changed, invalidate);
      window.removeEventListener("startupbot-zalo-scope-changed", invalidate);
      window.removeEventListener("focus", focused);
    };
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
  if (!view) return manage && error ? <p role="alert">{t("zalo.period.error")} <button className="ui-button" type="button"
    onClick={() => { setError(false); setRefresh(value => value + 1); }}>{t("common.tryAgain")}</button></p> : null;
  if (!manage && !view.schedule && !view.periods.length) return null;
  return <section className="grid gap-2 border-t border-hairline p-3 text-sm" aria-label={t("zalo.period.title")}>
    <h3 className="font-medium">{t("zalo.period.title")}</h3>
    <p>{t("zalo.period.source", view.source)}</p><p>{t("zalo.period.scope")}</p>
    {manage && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void save(form); }}>
      <label>{t("zalo.period.cadence")} <Select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value === "hourly" ? "hourly" : "daily" })}>
        <option value="daily">{t("zalo.period.daily")}</option><option value="hourly">{t("zalo.period.hourly")}</option></Select></label>
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
