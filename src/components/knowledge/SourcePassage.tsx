import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { citationLocation, citedPage } from "./citation";
import type { SourceDocument } from "./source-index";

export function SourcePassage({ doc, start }: { doc: SourceDocument; start: number }) {
  const passage = doc.passages.find(item => item.start === start);
  const page = citedPage(doc.path, passage?.page);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (page === null) { setPdfUrl(null); return; }
    const url = URL.createObjectURL(doc.file.slice(0, doc.file.size, "application/pdf"));
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [doc, page]);
  if (!passage) return null;
  return <section className="mt-4 rounded-lg bg-inset p-3">
    <h3 className="break-all font-medium">{citationLocation(doc.path, passage)}</h3>
    {pdfUrl && page !== null && <a className="text-accent-text hover:underline" target="_blank" rel="noopener noreferrer" href={pdfUrl + "#page=" + page}>{t("knowledge.openPdf")}</a>}
    <div className="mt-2 max-h-64 overflow-y-auto">{doc.passages.filter(p => p.page === passage.page && Math.abs(p.paragraph - passage.paragraph) <= 3 && Math.abs(p.start - start) < 8000).map(p =>
      <p key={p.start} ref={node => { if (p.start === start) node?.scrollIntoView?.({ block: "nearest" }); }}
        className={`mb-2 whitespace-pre-wrap break-words ${p.start === start ? "bg-accent/15" : ""}`}>{p.text}</p>)}</div>
  </section>;
}
