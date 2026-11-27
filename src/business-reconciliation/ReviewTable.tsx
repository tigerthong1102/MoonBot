import { useMemo, useState } from "react";
import type { SelectHTMLAttributes, ComponentType } from "react";
import { sourceRows, type Report } from "./report";
import type { Translate } from "./messages";
import { reviewStatuses, type ReviewChange, type ReviewStatus } from "./review";

export function ReviewTable({ report, t, initialChanges, persist, dropdown: Dropdown }: {
  report: Report; t: Translate; initialChanges: ReviewChange[]; persist(changes: ReviewChange[]): Promise<ReviewChange[]>; dropdown: "select" | ComponentType<Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">>;
}) {
  const [changes, setChanges] = useState(initialChanges);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState<ReviewStatus>("open");
  const latest = useMemo(() => new Map(changes.map(item => [item.document, item])), [changes]);
  const pageSize = 50;
  function select(id: string) {
    const current = latest.get(id);
    setDocumentId(id); setAssignee(current?.assignee ?? ""); setStatus(current?.status ?? "open");
  }
  async function record() {
    if (!documentId || saving) return;
    const next = [...changes, { document: documentId, at: new Date().toISOString(), assignee: assignee.trim(), status }];
    setChanges(next); setSaving(true);
    try { setChanges(await persist(next)); setFailed(false); }
    catch { setFailed(true); }
    finally { setSaving(false); }
  }
  function save() {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, report, changes })], { type: "application/json" }));
    link.href = url; link.download = "startupbot-review.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const selected = report.exceptions.find(item => item.document === documentId);
  const current = documentId === null ? undefined : latest.get(documentId);
  return <>
    <div className="reconcile-scroll"><table><thead><tr>
      <th>{t("reconcile.document")}</th><th>{t("reconcile.reason")}</th><th>{t("reconcile.difference")}</th>
      <th>{t("reconcile.review.owner")}</th><th>{t("reconcile.review.status")}</th>
    </tr></thead><tbody>{report.exceptions.slice(page * pageSize, (page + 1) * pageSize).map(row =>
      <tr key={row.document}><td><button type="button" className="ui-button ui-button-sm" onClick={() => select(row.document)}>{row.document}</button></td>
        <td>{row.reasons.map(key => t(key)).join(", ")}</td><td>{row.difference}</td><td>{latest.get(row.document)?.assignee}</td>
        <td>{t(`reconcile.review.${latest.get(row.document)?.status ?? "open"}`)}</td></tr>)}</tbody></table></div>
    {report.exceptions.length > pageSize && <div className="reconcile-actions">
      <button type="button" className="ui-button ui-button-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("reconcile.review.previous")}</button>
      <span>{page + 1} / {Math.ceil(report.exceptions.length / pageSize)}</span>
      <button type="button" className="ui-button ui-button-sm" disabled={(page + 1) * pageSize >= report.exceptions.length} onClick={() => setPage(page + 1)}>{t("reconcile.review.next")}</button>
    </div>}
    {documentId !== null && <fieldset><legend>{documentId}</legend>
      {selected?.leftSource && <p>{t("reconcile.left")} · {sourceRows(selected.leftSource)}</p>}
      {selected?.rightSource && <p>{t("reconcile.right")} · {sourceRows(selected.rightSource)}</p>}
      <label>{t("reconcile.review.owner")}<input maxLength={200} value={assignee} onChange={e => setAssignee(e.target.value)} /></label>
      <label>{t("reconcile.review.status")}<Dropdown value={status} onChange={e => setStatus(e.target.value as ReviewStatus)}>
        {reviewStatuses.map(value => <option key={value} value={value}>{t(`reconcile.review.${value}`)}</option>)}</Dropdown></label>
      <button type="button" className="ui-button ui-button-md" disabled={saving || ((current?.assignee ?? "") === assignee.trim() && (current?.status ?? "open") === status)}
        onClick={() => void record()}>{t("reconcile.review.record")}</button>
      {current && <details><summary>{t("reconcile.review.history")}</summary><ol>{changes.filter(change => change.document === documentId).map((change, i) =>
        <li key={i}><time dateTime={change.at}>{new Date(change.at).toLocaleString()}</time> · {change.assignee} · {t(`reconcile.review.${change.status}`)}</li>)}</ol></details>}
    </fieldset>}
    {failed && <p role="alert">{t("reconcile.review.localFailed")}</p>}
    <div className="reconcile-actions">
      <button type="button" className="ui-button ui-button-md" onClick={save}>{t("reconcile.review.save")}</button>
    </div>
  </>;
}
