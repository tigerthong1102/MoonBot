import { WorkflowDisclosure } from "./WorkflowDisclosure";
import { useEffect, useState } from "react";
import { isWorkflowWait, type WorkflowWait } from "../../../shared/skill-burger/approval";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { useStoreDispatch } from "@/state/store-select";

type WaitOwner = { botId: string; room?: never } | { botId?: never; room: { id: string; members: ReadonlyArray<{ id: string; name: string }> } };

export function WorkflowWaits({ botId, room, threadId, busy }: WaitOwner & { threadId: string; busy: boolean }) {
  const dispatch = useStoreDispatch();
  const [rows, setRows] = useState<WorkflowWait[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState("");
  const [revision, refresh] = useState(0);
  const query = `/workflow-approvals?threadId=${encodeURIComponent(threadId)}`;
  const path = room ? `/api/groups/${encodeURIComponent(room.id)}${query}` : `/api/bots/${encodeURIComponent(botId)}${query}`;
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      try {
        const result = await api<{ waits?: unknown } | null>(path, { signal: abort.signal, background: true });
        if (!abort.signal.aborted) setRows(Array.isArray(result?.waits) ? result.waits.filter(isWorkflowWait) : []);
      } catch { if (!abort.signal.aborted) setRows([]); }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { abort.abort(); window.removeEventListener("focus", load); };
  }, [path, busy, revision]);
  const decide = async (row: WorkflowWait, decision: "allow" | "deny") => {
    setSending(row.token); setError("");
    try {
      const member = room?.members.find(one => one.id === row.botId);
      if (room && !member) { refresh(value => value + 1); return; }
      const target = member?.id ?? botId;
      if (!target) return;
      const endpoint = `/api/bots/${encodeURIComponent(target)}${query}`;
      await api(endpoint, { method: "POST", body: JSON.stringify({ token: row.token, decision, reviewHash: row.reviewHash }) });
      if (decision === "allow") {
        const text = t("workflow.resumeMessage", { token: row.token });
        if (room && member) dispatch({ type: "sendGroup", groupId: room.id, threadId, text: `@${member.name} ${text}`, mentions: [member.id] });
        else if (botId) dispatch({ type: "send", botId, threadId, text });
      }
      refresh(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSending(""); }
  };
  const visible = room ? rows.filter(row => room.members.some(member => member.id === row.botId)) : rows;
  if (!visible.length) return null;
  return <section aria-label={t("workflow.waiting")} className="pointer-events-auto mx-auto max-h-64 w-full max-w-xl overflow-auto rounded-xl bg-card p-3 text-sm shadow-sm">
    {visible.map(row => <div key={row.token} className="space-y-1.5 py-1">
      <strong>{row.name} · {row.step}</strong><p>{row.message}</p>
      {row.action && <WorkflowDisclosure title={t("workflow.action")}><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all">{row.action}</pre></WorkflowDisclosure>}
      {row.state === "interrupted" || row.state === "unavailable" ? <p role="status">{t(row.state === "interrupted" ? "workflow.interrupted" : "skills.library.unavailable")}</p> : <div className="flex gap-2">
        <button type="button" className="ui-button ui-button-md" disabled={busy || !!sending} onClick={() => void decide(row, "allow")}>{t(row.state === "approved" ? "workflow.resume" : "workflow.approve")}</button>
        {row.state === "pending" && <button type="button" className="ui-button ui-button-md" disabled={!!sending} onClick={() => void decide(row, "deny")}>{t("common.cancel")}</button>}
      </div>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
