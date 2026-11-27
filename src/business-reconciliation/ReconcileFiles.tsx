import { useEffect, useRef, useState, type ComponentType, type SelectHTMLAttributes } from "react";
import { checkMapping, fields, guess, table, type Source } from "./compare";
import { authorizeExportReconciliation, runBusinessOperation } from "./operations";
import { readFileTable } from "./files";
import { htmlReport, type Report } from "./report";
import { errorText, ReconcileError, type Translate } from "./messages";
import { libraryKey } from "../components/knowledge/source-cache";
import { loadSavedReview, savedReviews, saveChanges, type ReviewFile, type SavedReview } from "./review-store";
import { openReview, type ReviewChange } from "./review";
import { ReviewTable } from "./ReviewTable";
import "./reconcile.css";

type Input = { source?: Source; name?: string; error?: string; busy?: boolean };
type Pair = [Input, Input];
const sides = ["reconcile.left", "reconcile.right"] as const;

type Dropdown = "select" | ComponentType<Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">>;

export default function ReconcileFiles({ close, dropdown: Dropdown, t, threadId }: { t: Translate; threadId?: string; close?: () => void; dropdown: Dropdown }) {
  const [inputs, setInputs] = useState<Pair>([{}, {}]);
  const versions = useRef([0, 0]);
  const [company, setCompany] = useState(""), [period, setPeriod] = useState("");
  const reviewFile = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<{ version: number; changes: ReviewChange[] }>({ version: 0, changes: [] });
  const fileVersion = useRef(0);
  const [owner, setOwner] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReview[]>([]);
  function showSaved(file: ReviewFile) {
    versions.current = versions.current.map(v => v + 1);
    setInputs([{}, {}]); setCompany(file.report.company); setPeriod(file.report.period);
    setReport(file.report); setReview(prev => ({ version: prev.version + 1, changes: file.changes })); setError("");
  }
  useEffect(() => {
    let active = true;
    const token = fileVersion.current;
    void (threadId ? libraryKey(threadId) : Promise.resolve("standalone")).then(async key => {
      if (!active || !key) return;
      setOwner(key);
      const list = await savedReviews(key);
      if (!active) return;
      setSaved(list);
      const latest = list[0] && await loadSavedReview(list[0].key);
      if (latest && active && token === fileVersion.current) showSaved(latest);
    }).catch(() => { if (active) setError(t("reconcile.review.localFailed")); });
    return () => { active = false; };
  }, [threadId, t]);
  async function remember(report: Report, changes: ReviewChange[]) {
    const key = owner ?? (threadId ? await libraryKey(threadId) : "standalone");
    if (!key) throw new Error("storage unavailable");
    const next = await saveChanges(key, report, changes);
    setSaved(await savedReviews(key));
    return next;
  }
  async function restore(file: File) {
    const token = ++fileVersion.current;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error();
      const saved = openReview(await file.text());
      if (token !== fileVersion.current) return;
      try {
        const changes = await remember(saved.report, saved.changes);
        if (token === fileVersion.current) showSaved({ ...saved, changes });
      } catch {
        if (token === fileVersion.current) { showSaved(saved); setError(t("reconcile.review.localFailed")); }
      }
    } catch { if (token === fileVersion.current) setError(t("reconcile.review.invalid")); }
  }
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState("");
  function clearReport() { fileVersion.current++; setReport(undefined); setReview(prev => ({ version: prev.version + 1, changes: [] })); setError(""); }
  function update(i: number, value: Input) {
    clearReport();
    setInputs(prev => i === 0 ? [value, prev[1]] : [prev[0], value]);
  }
  async function load(i: number, file?: File) {
    const version = ++versions.current[i];
    update(i, file ? { name: file.name, busy: true } : {});
    if (!file) return;
    try {
      const data = await readFileTable(file);
      if (version === versions.current[i]) update(i, { name: file.name, source: { data, mapping: guess(data.headers), separator: "." } });
    } catch (e) {
      if (version === versions.current[i]) update(i, { error: errorText(e, t) });
    }
  }
  function run() {
    clearReport();
    try {
      const a = inputs[0].source, b = inputs[1].source;
      if (!a || !b || !company.trim() || !period.trim()) throw new ReconcileError("reconcile.scopeRequired");
      const grant = authorizeExportReconciliation(a, b, { company: company.trim(), period: period.trim() });
      setReport(runBusinessOperation(grant));
    } catch (e) { setError(errorText(e, t)); }
  }
  function demo() {
    versions.current = versions.current.map(v => v + 1);
    const make = (rows: string[][]): Input => {
      const data = table([fields.map(f => t(`reconcile.${f}`)), ...rows]);
      return { name: t("reconcile.sample"), source: { data, mapping: { company: 0, period: 1, document: 2, amount: 3 }, separator: "." } };
    };
    setInputs([make([["CT01","2025","00017","120.0500"],["CT01","2025","00018","20"],["CT02","2025","00017","99"]]),
      make([["CT01","2025","00017","120.0400"],["CT01","2025","00019","20"]])]);
    setCompany("CT01"); setPeriod("2025"); clearReport();
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([htmlReport(report, t, document.documentElement.lang)], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "bao-cao-doi-chieu.html";
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const valid = inputs.every(input => {
    if (!input.source) return false;
    try { checkMapping(input.source.data, input.source.mapping); return true; } catch { return false; }
  });
  return <section className="reconciliation" aria-label={t("reconcile.title")}>
    <header><h1>{t("reconcile.title")}</h1>{close && <button className="ui-button ui-button-md" onClick={close}>{t("reconcile.close")}</button>}</header>
    <p>{t("reconcile.intro")}</p>
    {saved.length > 0 && <label>{t("reconcile.review.saved")}<Dropdown value="" onChange={e => {
      const key = e.target.value;
      const token = ++fileVersion.current;
      if (key) void loadSavedReview(key).then(file => { if (file && token === fileVersion.current) showSaved(file); }).catch(() => setError(t("reconcile.review.localFailed")));
    }}><option value="">{t("reconcile.review.saved")}</option>{saved.map(item =>
      <option key={item.key} value={item.key}>{item.company} · {item.period} · {new Date(item.at).toLocaleString()}</option>)}</Dropdown></label>}
    <button type="button" className="ui-button ui-button-md" onClick={() => reviewFile.current?.click()}>{t("reconcile.review.load")}</button>
    <input type="file" hidden ref={reviewFile} accept=".json" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void restore(file); }} />
    <div className="reconcile-pair">{inputs.map((input, i) => <fieldset key={i}>
      <legend>{t(sides[i])}</legend>
      <label>{t("reconcile.chooseFile")}<input type="file" accept=".csv,.xlsx,.xml,.xls" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (file) void load(i, file);
      }}/></label>
      {input.name && <small>{input.name}{input.source?.data.origin && " · " + input.source.data.origin.sheet}{input.busy ? " · " + t("reconcile.busy") : ""}</small>}
      {input.error && <p role="alert">{input.error}</p>}
      {input.source && fields.map(f => <label key={f}>{t(`reconcile.${f}`)}<Dropdown aria-label={t(sides[i]) + " · " + t(`reconcile.${f}`)} value={input.source!.mapping[f]} onChange={e => {
        const source = input.source!;
        update(i, { ...input, source: { ...source, mapping: { ...source.mapping, [f]: Number(e.target.value) } } });
      }}><option value={-1}>{t("reconcile.pickColumn")}</option>{input.source!.data.headers.map((h, n) => <option key={n} value={n}>{h}</option>)}</Dropdown></label>)}
      {input.source && <label>{t("reconcile.separator")}<Dropdown value={input.source.separator} onChange={e => update(i, { ...input, source: { ...input.source!, separator: e.target.value as "." | "," } })}>
        <option value=".">{t("reconcile.point")}</option><option value=",">{t("reconcile.comma")}</option></Dropdown></label>}
    </fieldset>)}</div>
    <div className="reconcile-scope"><label>{t("reconcile.scopeCompany")}<input value={company} onChange={e => { setCompany(e.target.value); clearReport(); }}/></label>
      <label>{t("reconcile.scopePeriod")}<input value={period} onChange={e => { setPeriod(e.target.value); clearReport(); }}/></label></div>
    <div className="reconcile-actions"><button className="ui-button ui-button-md ui-button-primary" disabled={!valid || !company.trim() || !period.trim()} onClick={run}>{t("reconcile.run")}</button><button className="ui-button ui-button-md" onClick={demo}>{t("reconcile.demo")}</button></div>
    {error && <p role="alert">{error}</p>}
    {report && <section aria-label={t("reconcile.results")}><h2>{t("reconcile.count", { count: report.exceptions.length })}</h2>
      <p>{report.company} · {report.period}<br/>{t("reconcile.fileTotal", { amount: report.left, rows: report.leftCount })} · {t("reconcile.referenceTotal", { amount: report.right, rows: report.rightCount })}<br/>{t("reconcile.difference")}: <b>{report.difference}</b></p>
      {report.exceptions.length > 0 && <ReviewTable key={review.version} initialChanges={review.changes} persist={changes => remember(report, changes)} report={report} t={t} dropdown={Dropdown} />}
      <button className="ui-button ui-button-md" onClick={download}>{t("reconcile.download")}</button></section>}
  </section>;
}
