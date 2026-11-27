import { useRef, useState } from "react";
import { supportsReadOnlyRoutine } from "../../../shared/routines";
import { buildBusinessRoutine, businessDemo, businessTemplates, templateSources, type BlueprintFields, type BusinessTemplate } from "@/lib/business-automations";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot } from "@/state/store";
import { Select } from "../Select";
import { ResultsDestination, resultsOfPlace, RoutineAudience } from "../routines/ResultsDestination";

export function BusinessBlueprintForm({ bot, onBack, onClose }: { bot: Bot; onBack(): void; onClose(): void }) {
  const { state, dispatch } = useStore();
  const [fields, setFields] = useState<BlueprintFields>({ template: "receivables", source: "Gmail", days: 7, recurrence: "weekdays",
    time: "08:00", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
  const [destination, setDestination] = useState<string | null | undefined>(() => resultsOfPlace(state, bot.id) ?? null);
  const [showDemo, setShowDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const driver = state.instances.find(instance => instance.instanceId === bot.modelSelection.instanceId)?.driverKind;
  const supported = supportsReadOnlyRoutine(driver);
  const change = (patch: Partial<BlueprintFields>) => {
    setFields(previous => ({ ...previous, ...patch }));
    setError("");
    setShowDemo(false);
  };
  const selectTemplate = (template: BusinessTemplate) => change({ template, source: templateSources[template][0] });
  async function save() {
    if (submitting.current || !supported) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const input = buildBusinessRoutine(fields, bot.id, destination);
      const response = await api("/api/routines", { method: "POST", body: JSON.stringify(input) });
      dispatch({ type: "routinePatched", routine: response.routine });
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-ink";
  return <form className="mt-4 space-y-4 text-[13px] text-ink-secondary" onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
      <label className="grid gap-1">{t("blueprint.report")}
        <Select value={fields.template} onChange={e => selectTemplate(e.target.value as BusinessTemplate)}>
          {businessTemplates.map(template => <option key={template} value={template}>{t(`blueprint.${template}`)}</option>)}
        </Select>
      </label>
      <label className="grid gap-1">{t("blueprint.source")}
        <Select value={fields.source} onChange={e => change({ source: e.target.value as BlueprintFields["source"] })}>
          {templateSources[fields.template].map(source => <option key={source}>{source}</option>)}
        </Select>
      </label>
      <label className="grid gap-1">{t("blueprint.window")}
        <Select value={fields.days} onChange={e => change({ days: Number(e.target.value) as BlueprintFields["days"] })}>
          {[1, 7, 30].map(days => <option key={days} value={days}>{t("blueprint.days", { days })}</option>)}
        </Select>
      </label>
      <label className="grid gap-1">{t("blueprint.repeat")}
        <Select value={fields.recurrence} onChange={e => change({ recurrence: e.target.value as BlueprintFields["recurrence"] })}>
          <option value="everyday">{t("routines.repeat.daily")}</option><option value="weekdays">{t("routines.repeat.weekdays")}</option>
          <option value="weekends">{t("widget.days.weekends")}</option>
        </Select>
      </label>
      <label className="grid gap-1">{t("blueprint.time")}<input type="time" required className={inputClass} value={fields.time} onChange={e => change({ time: e.target.value })} /></label>
      <label className="grid gap-1">{t("routines.cron.timeZone")}<input required className={inputClass} value={fields.timeZone} onChange={e => change({ timeZone: e.target.value })} /></label>
    </fieldset>
    <ResultsDestination bot={bot} value={destination} onChange={setDestination} team={Boolean(state.config?.team)} />
    <RoutineAudience team={state.config?.team} bot={bot} value={destination} />
    <button type="button" onClick={() => setShowDemo(true)} className="ui-button">{t("blueprint.try")}</button>
    {showDemo && <section aria-live="polite" className="rounded-lg bg-raised p-3"><h3 className="font-medium text-ink">{t("blueprint.demo")}</h3>
      <ul>{businessDemo(fields).map(row => <li key={row}>{row}</li>)}</ul></section>}
    {!supported && <p role="note">{t("blueprint.engine")}</p>}
    {error && <p role="alert" className="text-warning">{error}</p>}
    <div className="flex items-center justify-between">
      <button type="button" disabled={busy} className="ui-button" onClick={onBack}>{t("automations.newBox.back")}</button>
      <button type="submit" disabled={busy || !supported} className="ui-button ui-button-pill ui-button-primary">{t("blueprint.install")}</button>
    </div>
  </form>;
}
