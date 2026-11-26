import { useEffect, useState } from "react";
import { Select } from "../Select";
import { t } from "@/lib/i18n";
import type { AppDocument } from "../../../shared/app";
import { fetchAppDocument } from "./app-api";
import { APP_FRAME_SANDBOX } from "./app-frame-host";

/** The same address always fetches the published version with this viewer's session. */
export default function InternalReport({ threadId, messageId }: { threadId: string; messageId: string }) {
  const [doc, setDoc] = useState<AppDocument | null>(null);
  const [sections, setSections] = useState<NonNullable<AppDocument["sections"]>>([]);
  const [selection, setSelection] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setDoc(null); setFailed(false);
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const root = await fetchAppDocument(threadId, messageId, controller.signal, undefined, true);
        if (controller.signal.aborted) return;
        const choices = root.sections ?? [];
        setSections(choices);
        const activeSection = choices.find(s => s.threadId + "/" + s.messageId === selection);
        if (selection && !activeSection) { setDoc(null); setSelection(""); return; }
        const next = activeSection ? await fetchAppDocument(activeSection.threadId, activeSection.messageId, controller.signal, undefined, true) : root;
        if (!controller.signal.aborted) {
          setDoc(previous => previous?.rev === next.rev && previous.srcdoc === next.srcdoc ? previous : next);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) { setDoc(null); setSections([]); setSelection(""); setFailed(true); }
      } finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [threadId, messageId, selection]);
  return <main className="flex h-dvh flex-col bg-card text-ink">
    {sections.length > 0 && <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
      <label className="flex items-center gap-2 text-sm">{t("knowledge.sections")}<Select value={selection} onChange={e => { setDoc(null); setSelection(e.target.value); }}>
        <option value="">{t("knowledge.report")}</option>{sections.map(section => <option key={section.threadId + "/" + section.messageId}
          value={section.threadId + "/" + section.messageId}>{section.title}</option>)}</Select></label></header>}
    {doc ? <iframe title={t("knowledge.report")} className="min-h-0 flex-1 border-0" sandbox={APP_FRAME_SANDBOX}
      referrerPolicy="no-referrer" srcDoc={doc.srcdoc} /> : <p role={failed ? "alert" : "status"} className="m-auto p-5">
      {t(failed ? "knowledge.reportUnavailable" : "knowledge.reading")}</p>}
  </main>;
}
