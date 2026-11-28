import { lazy, Suspense, useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import type { Bot } from "@/state/store";
import { AI_TWIN_PATH, AI_TWIN_QUESTION_MAX, type AiTwinView } from "../../shared/ai-twin";
import { buildZaloReport, matchesZaloReport, reviewZaloExcerpt, ZALO_IMPORT_LIMIT, ZALO_RECIPES, type ZaloRecipe, type ZaloSourceLine, type ZaloReportFilter, type ZaloReportRow } from "../../shared/zalo-intelligence";
import { ZaloReportControls } from "./ZaloReportControls";
import { Layer } from "./Layer";
import { Select } from "./Select";
import { AiTwinPreview } from "./AiTwinPreview";
import { SETTINGS_INPUT, SettingsField, SettingsFoldRow } from "./SettingsPrimitives";

function TwinForExcerpt({ text, source }: { text: string; source: ZaloSourceLine }) {
  const [view, setView] = useState<AiTwinView | null>(null);
  const [recipe, setRecipe] = useState<ZaloRecipe | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setFailed(false);
    setView(null);
    void api<AiTwinView>(AI_TWIN_PATH, { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) setView(result);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [attempt]);
  if (failed) return <button type="button" className="ui-button" onClick={() => setAttempt(a => a + 1)}>{t("common.tryAgain")}</button>;
  if (!view) return <p role="status">{t("zalo.loading")}</p>;
  if (!view.twin || view.twin.paused) return <p role="status">{t("zalo.twinUnavailable")}</p>;
  return <><SettingsField label={t("zalo.purpose")}><Select className={SETTINGS_INPUT} value={recipe ?? ""}
    onChange={event => setRecipe(ZALO_RECIPES.find(id => id === event.target.value))}>
    <option value="">{t("settings.aiTwin.generateDraft")}</option>
    {ZALO_RECIPES.map(id => <option key={id} value={id}>{t(`zalo.${id}`)}</option>)}
  </Select></SettingsField><AiTwinPreview key={view.twin.id + (recipe ?? "")} zaloRecipe={recipe} zaloSource={source} twin={view.twin} provider={view.preview} initialQuestion={text}
    allowSemantic={Boolean(view.lessons?.some(lesson => lesson.allowProvider))} refresh={() => setAttempt(a => a + 1)} /></>;
}

const WorkflowReview = lazy(() => import("./ZaloWorkflowReview"));
const RoutineEditor = lazy(() => import("./RoutineCalendarPage").then(module => ({ default: module.EventEditor })));
const BrainDialog = lazy(() => import("./knowledge/BrainDialog"));

type ExcerptOptions = { twinEnabled: boolean; bot?: Bot };

function ExcerptReview({ twinEnabled, bot }: ExcerptOptions) {
  const [source, setSource] = useState("");
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<ZaloReportRow[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<ZaloReportFilter>("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const [reminder, setReminder] = useState<{ line: number; at: number } | null>(null);
  const [workflowLine, setWorkflowLine] = useState<number | null>(null);
  const [brain, setBrain] = useState<ZaloReportRow | null>(null);
  const closeBrain = useCallback(() => setBrain(null), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setRows(buildZaloReport(reviewZaloExcerpt(input)));
      setInput("");
      setError(false);
    } catch {
      setError(true);
    }
  }
  if (!rows) return <form className="flex flex-col gap-3" onSubmit={submit}>
    <SettingsField label={t("zalo.source")}><input required maxLength={120} spellCheck={false} className={SETTINGS_INPUT}
      value={source} onChange={event => setSource(event.target.value)} /></SettingsField>
    <SettingsField label={t("zalo.excerpt")} hint={t("zalo.scope")}><textarea required spellCheck={false} autoComplete="off"
      className={`${SETTINGS_INPUT} h-auto py-2`} rows={5} value={input} onChange={event => {
        const value = event.target.value;
        setError(value.length > ZALO_IMPORT_LIMIT);
        setInput(value.length > ZALO_IMPORT_LIMIT ? "" : value);
      }} /></SettingsField>
    {error && <p role="alert" className="text-danger">{t("zalo.limit")}</p>}
    <button className="ui-button self-start" type="submit" disabled={!source.trim() || !input.trim()}>{t("zalo.review")}</button>
  </form>;

  const visible = rows.filter(row => matchesZaloReport(row, filter));
  const pageSize = 20;
  function move(next: number) { setWorkflowLine(null); setSelected(null); setPage(next); }
  function clear() { setRows(null); setSource(""); setInput(""); closeBrain(); setReminder(null); setFilter("all"); move(0); }
  return <section className="flex flex-col gap-3">
    <ZaloReportControls rows={rows} source={source} filter={filter} onFilter={next => { setFilter(next); move(0); }} />
    {!visible.length && <p role="status">{t("zalo.report.empty")}</p>}
    <ol className="flex flex-col gap-3">{visible.slice(page * pageSize, (page + 1) * pageSize).map(row =>
      <li key={row.line} className="flex flex-col gap-1">
        <span className="text-ink-secondary">{t("zalo.line", { line: row.line })} · {row.intents.map(intent => t(`zalo.intent.${intent}`)).join(", ")}{row.urgent && <> · {t("zalo.urgent")}</>}</span>
        <p dir="auto" className="whitespace-pre-wrap break-words">{row.text}</p>
        {row.work.length > 0 && <p>{t("zalo.report.proposal", { action: row.work.map(item => t(`zalo.report.action.${item}`)).join(", ") })}</p>}
        {row.deadlineText && <p>{t("zalo.report.deadline", { quote: row.deadlineText })}</p>}
        {row.repeatedLine !== undefined && <p>{t("zalo.report.repeated", { line: row.repeatedLine })}</p>}
        {twinEnabled && row.text.length <= AI_TWIN_QUESTION_MAX && <button type="button" className="ui-button self-start" aria-expanded={selected === row.line}
          onClick={() => setSelected(selected === row.line ? null : row.line)}>{t("settings.aiTwin.preview")}</button>}
        {bot && row.text.length <= 1_000 && <button type="button" className="ui-button self-start" onClick={() => setBrain(row)}>{t("zalo.brain")}</button>}
        {bot && (row.work.length > 0 || row.deadlineText) && <button type="button" className="ui-button self-start" onClick={() => setReminder({ line: row.line, at: Date.now() + 3_600_000 })}>{t("zalo.prepareReminder")}</button>}
        {bot && row.work.length > 0 && <button type="button" className="ui-button self-start" aria-expanded={workflowLine === row.line}
          onClick={() => setWorkflowLine(workflowLine === row.line ? null : row.line)}>{t("zalo.workflow.review")}</button>}
        {bot && workflowLine === row.line && <Suspense><WorkflowReview key={bot.threadId + ":" + row.line} bot={bot} source={source} line={row.line} /></Suspense>}
        {selected === row.line && <TwinForExcerpt text={row.text} source={{ source, line: row.line }} />}
      </li>)}</ol>
    {bot && reminder && <Layer modal><Suspense><RoutineEditor routinesOnly lockedBotId={bot.id} bots={[bot]}
      seed={{ kind: "routine", at: reminder.at, durationMinutes: 15, botIds: [bot.id], name: t("zalo.reminderTitle"), description: t("zalo.reminderPrompt", { line: reminder.line }) }}
      onSavedCall={() => {}} onClose={() => setReminder(null)} /></Suspense></Layer>}
    {bot && brain && <Layer modal><Suspense><BrainDialog threadId={bot.threadId} initialQuery={brain.text} zaloExcerpt={twinEnabled ? { source, line: brain.line, text: brain.text } : undefined} close={closeBrain} /></Suspense></Layer>}
    <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className="ui-button" onClick={() => move(page - 1)}>{t("zalo.previous")}</button>}
      {(page + 1) * pageSize < visible.length && <button type="button" className="ui-button" onClick={() => move(page + 1)}>{t("zalo.next")}</button>}
      <button type="button" className="ui-button" onClick={clear}>{t("zalo.clear")}</button>
    </div>
  </section>;
}

export function ZaloImportSection({ twinEnabled, bot }: ExcerptOptions) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <SettingsFoldRow id="zalo-excerpt" panelId={id} title={t("zalo.title")} subtitle={t("zalo.description")} open={open} onToggle={() => setOpen(!open)}>
    {open && <ExcerptReview twinEnabled={twinEnabled} bot={bot} />}
  </SettingsFoldRow>;
}
