import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import type { Bot } from "@/state/store";
import { ZALO_MODEL_CHARS, ZALO_MODEL_LINES, ZALO_MODEL_RECIPES, type ZaloConversationKind, type ZaloModelFinding,
  type ZaloModelLine, type ZaloModelOffer, type ZaloModelRecipe } from "../../shared/zalo-model-analysis";
import { Select } from "./Select";
import { SETTINGS_INPUT, SettingsField } from "./SettingsPrimitives";

export function ZaloModelAnalysis({ bot, source, rows }: { bot: Bot; source: string; rows: ZaloModelLine[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div><button type="button" className="ui-button" aria-expanded={open} aria-controls={id}
    onClick={() => setOpen(!open)}>{t("zalo.model.open")}</button>
    <section id={id} hidden={!open}>{open && <ReviewModelLines bot={bot} source={source} rows={rows} />}</section></div>;
}

function ReviewModelLines({ bot, source, rows }: { bot: Bot; source: string; rows: ZaloModelLine[] }) {
  const path = "/api/bots/" + encodeURIComponent(bot.id) + "/zalo-model-analysis?thread=" + encodeURIComponent(bot.threadId);
  const [chosen, setChosen] = useState<number[]>([]);
  const [recipe, setRecipe] = useState<ZaloModelRecipe>("accounting");
  const [conversation, setConversation] = useState<ZaloConversationKind>("unspecified");
  const [offer, setOffer] = useState<ZaloModelOffer | null>(null);
  const [error, setError] = useState(false);
  const [spent, setSpent] = useState(false);
  const [running, setRunning] = useState(false);
  const [findings, setFindings] = useState<ZaloModelFinding[] | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const selected = rows.filter(row => chosen.includes(row.line)).map(({ line, text }) => ({ line, text }));
  const chars = selected.reduce((size, row) => size + row.text.length, 0);
  useEffect(() => {
    const controller = new AbortController();
    setOffer(null);
    setSpent(false);
    setError(false);
    void api<ZaloModelOffer>(path, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setOffer(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [path, revision]);
  function reset() { setFindings(null); }
  async function analyze() {
    if (!offer || !selected.length || running || chars > ZALO_MODEL_CHARS) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true); setSpent(true); setOffer(null); setError(false); reset();
    try {
      const result = await api<{ findings: ZaloModelFinding[] }>(path, { method: "POST", signal: controller.signal, timeoutMs: 70_000,
        body: JSON.stringify({ consent: true, token: offer.token, recipe, conversation, lines: selected }) });
      if (!controller.signal.aborted) setFindings(result.findings);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setRunning(false); }
  }
  return <div className="mt-3 flex flex-col gap-2">
    <SettingsField label={t("zalo.purpose")}><Select className={SETTINGS_INPUT} value={recipe} disabled={running}
      onChange={e => { setRecipe(e.target.value as ZaloModelRecipe); reset(); }}>
      {(Object.keys(ZALO_MODEL_RECIPES) as ZaloModelRecipe[]).map(key => <option key={key} value={key}>{t(`zalo.model.recipe.${key}`)}</option>)}
    </Select></SettingsField>
    <SettingsField label={t("zalo.model.sourceType")}><Select className={SETTINGS_INPUT} value={conversation} disabled={running}
      onChange={e => { setConversation(e.target.value as ZaloConversationKind); reset(); }}>
      {(["unspecified", "direct", "group"] as const).map(key => <option key={key} value={key}>{t(`zalo.model.source.${key}`)}</option>)}
    </Select></SettingsField>
    <fieldset className="flex flex-col gap-1" disabled={running}><legend>{t("zalo.model.lines", { source, count: ZALO_MODEL_LINES })}</legend>
      {rows.map(row => <label key={row.line} className="flex items-start gap-2"><input type="checkbox" checked={chosen.includes(row.line)}
        disabled={!chosen.includes(row.line) && (chosen.length >= ZALO_MODEL_LINES || chars + row.text.length > ZALO_MODEL_CHARS)}
        onChange={e => { setChosen(e.target.checked ? [...chosen, row.line] : chosen.filter(n => n !== row.line)); reset(); }} />
        <span>{t("zalo.line", { line: row.line })} · {row.text}</span></label>)}
    </fieldset>
    {offer && <><p>{t("zalo.model.destination", { provider: offer.provider, model: offer.model })}</p>
      <button type="button" className="ui-button self-start" disabled={!chosen.length || running} onClick={() => void analyze()}>{t("zalo.model.send")}</button></>}
    {running && <p role="status">{t("zalo.loading")}</p>}
    {error && <p role="alert">{t("zalo.model.unavailable")}</p>}
    {findings && (findings.length ? <ul>{findings.map(f => <li key={JSON.stringify(f)}>
      {t(`zalo.model.kind.${f.kind}`)} · {source} · {t("zalo.line", { line: f.line })} · <q dir="auto">{f.quote}</q>
    </li>)}</ul> : <p role="status">{t("zalo.model.noFindings")}</p>)}
    {!offer && !running && (error || spent) && <button type="button" className="ui-button self-start"
      onClick={() => setRevision(n => n + 1)}>{t("zalo.model.check")}</button>}
  </div>;
}
