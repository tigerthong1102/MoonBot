import { useEffect, useState } from "react";
import type { WorkflowWait } from "../../../shared/skill-burger/approval";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { useStoreDispatch } from "@/state/store-select";

export function WorkflowWaits({ botId, threadId, busy }: { botId: string; threadId: string; busy: boolean }) {
  const dispatch = useStoreDispatch();
  const [rows, setRows] = useState<WorkflowWait[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState("");
  const [revision, refresh] = useState(0);
  const path = `/api/bots/${encodeURIComponent(botId)}/workflow-approvals?threadId=${encodeURIComponent(threadId)}`;
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      try {
        const result = await api<{ waits: WorkflowWait[] }>(path, { signal: abort.signal, background: true });
        if (!abort.signal.aborted) setRows(result.waits);
      } catch { if (!abort.signal.aborted) setRows([]); }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { abort.abort(); window.removeEventListener("focus", load); };
  }, [path, busy, revision]);
  const decide = async (row: WorkflowWait, decision: "allow" | "deny") => {
    setSending(row.token); setError("");
    try {
      await api(path, { method: "POST", body: JSON.stringify({ token: row.token, decision }) });
      if (decision === "allow") dispatch({ type: "send", botId, threadId, text: t("workflow.resumeMessage", { token: row.token }) });
      refresh(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSending(""); }
  };
  if (!rows.length) return null;
  return <section aria-label={t("workflow.waiting")} className="pointer-events-auto mx-auto max-h-64 w-full max-w-xl overflow-auto rounded-xl bg-card p-3 text-sm shadow-sm">
    {rows.map(row => <div key={row.token} className="space-y-1.5 py-1">
      <strong>{row.name} · {row.step}</strong><p>{row.message}</p>
      {row.action && <details><summary>{t("workflow.action")}</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all">{row.action}</pre></details>}
      {row.state === "interrupted" || row.state === "unavailable" ? <p role="status">{t(row.state === "interrupted" ? "workflow.interrupted" : "skills.library.unavailable")}</p> : <div className="flex gap-2">
        <button type="button" className="ui-button ui-button-md" disabled={busy || !!sending} onClick={() => void decide(row, "allow")}>{t(row.state === "approved" ? "workflow.resume" : "workflow.approve")}</button>
        {row.state === "pending" && <button type="button" className="ui-button ui-button-md" disabled={!!sending} onClick={() => void decide(row, "deny")}>{t("common.cancel")}</button>}
      </div>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
