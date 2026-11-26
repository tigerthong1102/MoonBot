import { useEffect, useRef, useState } from "react";
import { MAX_INSTRUCTION_CASES, type InstructionCase, type InstructionCaseResult, type InstructionStudioView } from "../../../shared/instruction-studio";
import { sameModelSelection } from "../../../shared/thread-model";
import { isEffortLevel, type ModelSelection } from "../../../shared/wire";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { intlLocale, t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { inputCls } from "./field";

const button = "rounded-md border border-hairline/50 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-control disabled:opacity-50";
const blankCase = () => ({ question: "", expected: "" });

export function InstructionStudio({ bot }: { bot: Bot }) {
  const { draft: creation, request } = useBotEditor();
  const { flushBotPatches, state } = useStore();
  const owner = useOwnerOrAdmin();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<InstructionStudioView | null>(null);
  const [soul, setSoul] = useState("");
  const [selection, setSelection] = useState<ModelSelection>(bot.modelSelection);
  const [cases, setCases] = useState<InstructionCase[]>([]);
  const [results, setResults] = useState<InstructionCaseResult[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  if (creation || owner === false) return null;
  const url = "/api/bots/" + bot.id + "/instruction-studio";
  const dirty = view && (view.draft.soul !== soul || !sameModelSelection(view.draft.selection, selection) || JSON.stringify(view.draft.cases) !== JSON.stringify(cases));
  const stale = view && view.revision !== view.draft.baseRevision;
  const valid = cases.every(item => item.question.trim() && item.expected.trim());
  const instance = state.instances.find(item => item.instanceId === selection.instanceId);
  const choices = state.instances.filter(item => item.snapshot.state === "available" && !item.policy).flatMap(item => item.models.options
    .filter(option => !option.orgBlocked && !option.needsCliUpdate)
    .map(option => ({ id: JSON.stringify([item.instanceId, option.id]), label: item.displayName + " · " + option.id })));
  const selected = JSON.stringify([selection.instanceId, selection.model]);
  if (choices.every(item => item.id !== selected)) choices.push({ id: selected, label: selection.instanceId + " · " + selection.model });
  const variants = instance?.capabilities?.modelVariants ? instance.models.options.find(item => item.id === selection.model)?.variants : undefined;
  const efforts = instance?.capabilities?.effortLevels;
  function changeModel(next: ModelSelection) {
    setSelection(next); setResults([]); setNotice("");
  }
  function show(next: InstructionStudioView) {
    setView(next);
    setSoul(next.draft.soul);
    setSelection(next.draft.selection);
    setCases(next.draft.cases);
    setResults([]);
  }
  async function act(action: "load" | "save" | "reset" | "publish" | "test" | "restore", version?: string) {
    if (active.current) return;
    const controller = new AbortController();
    const signal = action === "test" ? AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]) : controller.signal;
    active.current = controller;
    setBusy(true);
    setTesting(action === "test");
    setNotice("");
    setError("");
    try {
      await flushBotPatches(bot.id);
      if (action === "load") { show(await request<InstructionStudioView>(url, { signal })); return; }
      if (!view) return;
      const payload = { id: view.draft.id, revision: view.revision };
      if (action === "test") {
        setResults([]);
        for (let index = 0; index < cases.length; index++) {
          const result = await request<InstructionCaseResult>(url + "/test", {
            method: "POST", body: JSON.stringify({ ...payload, index }), signal, timeoutMs: 95_000,
          });
          setResults(previous => [...previous, result]);
        }
        return;
      }
      const body = action === "save" ? { ...payload, soul, cases, selection } : action === "restore" ? { ...payload, version } : payload;
      show(await request<InstructionStudioView>(url + "/" + action, { method: "POST", body: JSON.stringify(body), signal }));
      setNotice(t(action === "restore" || action === "publish" ? "studio.published" : "studio.saved"));
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : String(err));
      else if (action === "test") setNotice(t("studio.stopped"));
    } finally {
      active.current = null;
      setBusy(false);
      setTesting(false);
    }
  }
  function update(index: number, field: keyof InstructionCase, value: string) {
    setCases(cases.map((item, i) => i === index ? { ...item, [field]: value } : item));
    setResults([]);
    setNotice("");
  }
  return (
    <details className="text-[13px] text-ink" open={open} onToggle={event => {
      const next = event.currentTarget.open;
      setOpen(next);
      if (next && !view) void act("load");
    }}>
      <summary className="cursor-pointer py-2 font-medium text-ink">{t("studio.title")}</summary>
      {open && <div className="flex flex-col gap-2.5 py-2">
        {view && <>
          <label className="space-y-1">{t("studio.instructions")}
            <textarea className={inputCls} rows={5} value={soul} disabled={busy || !!stale} onChange={event => {
              setSoul(event.target.value); setResults([]); setNotice("");
            }} />
          </label>
          <label>{t("model.section.default")}
            <select className={inputCls} value={selected} disabled={busy || !!stale} onChange={e => {
              const [instanceId, model] = JSON.parse(e.target.value) as [string, string];
              changeModel({ instanceId, model });
            }}>
              {choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {(variants?.length || efforts?.length) ? <label>{t("model.section.effort")}
            <select className={inputCls} disabled={busy || !!stale} value={selection.variant ?? selection.effort ?? ""} onChange={e => {
              const value = e.target.value;
              changeModel({ instanceId: selection.instanceId, model: selection.model, ...(value && variants?.length ? { variant: value } : isEffortLevel(value) ? { effort: value } : {}) });
            }}>
              <option value="">{t("model.effort.default")}</option>
              {variants?.length ? variants.map(item => <option key={item.id} value={item.id}>{item.label || item.id}</option>)
                : efforts?.map(effort => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          </label> : null}
          <details><summary className="cursor-pointer text-ink-secondary">{t("studio.live")}</summary>
            <p>{view.liveSelection.instanceId} · {view.liveSelection.model} {view.liveSelection.effort ?? view.liveSelection.variant}</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{view.liveSoul || "—"}</pre>
          </details>
          {stale && <p role="status">{t("studio.stale")}</p>}
          <p className="text-ink-secondary">{t("studio.help", { model: [view.liveSelection.model, selection.model].filter((item, i, all) => all.indexOf(item) === i).join(" / ") })}</p>
          {cases.map((item, i) => <fieldset key={i} disabled={busy || !!stale} className="flex min-w-0 flex-col gap-2 rounded-lg border border-hairline/40 p-2">
            <legend>{t("studio.case", { n: i + 1 })}</legend>
            <label>{t("studio.question")}<textarea rows={2} maxLength={2000} value={item.question} className={inputCls} onChange={e => update(i, "question", e.target.value)} /></label>
            <label>{t("studio.expected")}<input value={item.expected} maxLength={500} className={inputCls} onChange={e => update(i, "expected", e.target.value)} /></label>
            <button type="button" className={button + " self-end"} onClick={() => { setCases(cases.filter((_, n) => n !== i)); setResults([]); }}>{t("studio.remove")}</button>
            {results[i] && <div aria-live="polite">
              <strong>{t(results[i].draft.pass ? (results[i].live.pass ? "studio.bothPass" : "studio.improved")
                : (results[i].live.pass ? "studio.regressed" : "studio.bothFail"))}</strong>
              {(["live", "draft"] as const).map(side => <details key={side}>
                <summary className="cursor-pointer">{t(side === "live" ? "studio.live" : "studio.instructions")} · {t(results[i][side].pass ? "studio.pass" : "studio.fail")}</summary>
                <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{results[i][side].answer}</p>
              </details>)}
            </div>}
          </fieldset>)}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy || !!stale || cases.length >= MAX_INSTRUCTION_CASES} onClick={() => { setCases([...cases, blankCase()]); setResults([]); }}>{t("studio.add")}</button>
            <button type="button" className={button} disabled={busy || !!stale || !valid || !dirty} onClick={() => void act("save")}>{t("studio.save")}</button>
            <button type="button" className={button} disabled={busy || !!stale || !!dirty || !cases.length || !view.canTest || !view.draft.id} onClick={() => void act("test")}>{t("studio.run", { n: cases.length * 2 })}</button>
            <button type="button" className={button} disabled={busy || !!stale || !!dirty || !view.draft.id || (view.liveSoul === soul && sameModelSelection(view.liveSelection, selection))} onClick={() => void act("publish")}>{t("studio.publish")}</button>
            {stale && <button type="button" className={button} disabled={busy} onClick={() => void act("reset")}>{t("studio.reset")}</button>}
          </div>
          {view.history.length > 0 && <details>
            <summary className="cursor-pointer">{t("studio.versions")}</summary>
            {view.history.map(row => <div key={row.id} className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1">
                {new Date(row.at).toLocaleString(intlLocale())} · {row.instanceId} · {row.model} {row.effort}
                <span className="block break-words text-xs text-ink-secondary">{row.instructionsPreview}</span>
              </span>
              <button type="button" className={button} disabled={busy || !!dirty || !row.canRestore} title={row.canRestore ? undefined : t("history.restoreUnavailable")} onClick={() => void act("restore", row.id)}>{t("studio.restore")}</button>
            </div>)}
          </details>}
          {!view.canTest && <p className="text-ink-secondary">{t("studio.unsupported")}</p>}
        </>}
        {busy && <p role="status">{t("studio.working")}</p>}
        {testing && <button type="button" className={button} onClick={() => active.current?.abort()}>{t("studio.stop")}</button>}
        {notice && <p role="status">{notice}</p>}
        {error && <div role="alert">{error} <button type="button" className={button} disabled={busy} onClick={() => void act("load")}>{t("studio.reload")}</button></div>}
      </div>}
    </details>
  );
}
