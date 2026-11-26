import { useState } from "react";
import { api } from "@/state/api";
import { readReportLink } from "@/lib/report-link";
import { t } from "@/lib/i18n";
import type { AppDocument } from "../../../shared/app";
import { appDocumentPath, fetchAppDocument } from "./app-api";

type Section = NonNullable<AppDocument["sections"]>[number];

export function InternalReportSections({ threadId, messageId, url }: { threadId: string; messageId: string; url: string }) {
  const [value, setValue] = useState("");
  const [list, setList] = useState<Section[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function load() {
    const result = await fetchAppDocument(threadId, messageId, undefined, undefined, { report: true });
    setList(result.sections ?? []);
  }
  async function change(ref?: Section) {
    setBusy(true); setFailed(false);
    try {
      let target = ref;
      if (!target) {
        const link = new URL(value.trim());
        const id = readReportLink(link.searchParams);
        if (!id || ![new URL(url).origin, window.location.origin].includes(link.origin)) throw new Error();
        target = { ...id, title: "" };
      }
      await api(appDocumentPath(threadId, messageId) + "/sections", { method: "POST", body: JSON.stringify({
        action: ref ? "remove" : "add", sourceThread: target.threadId, sourceMessage: target.messageId,
      }) });
      await load(); setValue("");
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <details className="basis-full" onToggle={event => { if (event.currentTarget.open) void load().catch(() => setFailed(true)); }}>
    <summary className="cursor-pointer text-xs">{t("knowledge.sections")}</summary>
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs">{t("knowledge.sectionLink")}<input type="url" maxLength={2048} value={value} onChange={e => setValue(e.target.value)}
        className="mt-1 block w-full rounded border border-hairline bg-card px-2 py-1.5" /></label>
      <button type="button" className="ui-button ui-button-sm" disabled={busy || !value.trim()} onClick={() => void change()}>{t("knowledge.addSection")}</button>
    </div>
    <ul>{list.map(ref => <li className="mt-2 flex items-center gap-2" key={ref.threadId + "/" + ref.messageId}>{ref.title}
      <button type="button" className="ui-button ui-button-sm" disabled={busy} onClick={() => void change(ref)}>{t("knowledge.removeSection")}</button></li>)}</ul>
    {failed && <p role="alert" className="text-xs text-danger">{t("knowledge.sectionFailed")}</p>}
  </details>;
}
