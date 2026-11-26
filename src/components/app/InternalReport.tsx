import { useEffect, useState } from "react";
import { productName } from "@/lib/brand";
import { Select } from "../Select";
import { t } from "@/lib/i18n";
import type { AppDocument } from "../../../shared/app";
import { AppDocumentError, fetchAppDocument } from "./app-api";
import { ReportFrame } from "./ReportFrame";

export default function InternalReport({ threadId, messageId }: { threadId: string; messageId: string }) {
  const [doc, setDoc] = useState<AppDocument | null>(null);
  const [sections, setSections] = useState<NonNullable<AppDocument["sections"]>>([]);
  const [selection, setSelection] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setDoc(null); setFailed(false);
    const controller = new AbortController();
    let busy = false;
    async function refresh(background = false) {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const root = await fetchAppDocument(threadId, messageId, controller.signal, undefined, { report: true, background });
        if (controller.signal.aborted) return;
        const choices = root.sections ?? [];
        setSections(choices);
        const activeSection = choices.find(s => s.threadId + "/" + s.messageId === selection);
        if (selection && !activeSection) { setDoc(null); setSelection(""); return; }
        const next = activeSection ? await fetchAppDocument(activeSection.threadId, activeSection.messageId, controller.signal, undefined, { report: true, background }) : root;
        if (!controller.signal.aborted) {
          setDoc(previous => previous?.rev === next.rev && previous.srcdoc === next.srcdoc && previous.can.openLinks === next.can.openLinks ? previous : next);
          setFailed(false);
        }
      } catch (error) {
        if (controller.signal.aborted || (background && error instanceof AppDocumentError && !error.failure.offline && error.failure.asleep)) return;
        setDoc(null); setSections([]); setSelection(""); setFailed(true);
      } finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 30_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [threadId, messageId, selection]);
  return <main className="flex h-dvh flex-col bg-card text-ink">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-4 py-2">
      <h1 className="text-sm font-semibold">{productName()} · {t("knowledge.report")}</h1>
      {sections.length > 0 && <label className="flex items-center gap-2 text-sm">{t("knowledge.sections")}<Select value={selection} onChange={e => { setDoc(null); setSelection(e.target.value); }}>
        <option value="">{t("knowledge.report")}</option>{sections.map(section => <option key={section.threadId + "/" + section.messageId}
          value={section.threadId + "/" + section.messageId}>{section.title}</option>)}</Select></label>}</header>
    {doc ? <ReportFrame doc={doc} /> : <p role={failed ? "alert" : "status"} className="m-auto p-5">
      {t(failed ? "knowledge.reportUnavailable" : "knowledge.reading")}</p>}
  </main>;
}
