import { SourcePdf } from "./SourcePdf";
import { citationLocation, citedPage } from "./citation";
import type { SourceDocument } from "./source-index";

export function SourcePassage({ doc, start }: { doc: SourceDocument; start: number }) {
  const passage = doc.passages.find(item => item.start === start);
  const page = citedPage(doc.path, passage?.page);
  if (!passage) return null;
  return <section className="mt-4 rounded-lg bg-inset p-3">
    <h3 className="break-all font-medium">{citationLocation(doc.path, passage)}</h3>
    {page !== null && <SourcePdf key={JSON.stringify([doc.path, doc.digest, page])} file={doc.file} path={doc.path} page={page} />}
    <div className="mt-2 max-h-64 overflow-y-auto">{doc.passages.filter(p => p.page === passage.page && Math.abs(p.paragraph - passage.paragraph) <= 3 && Math.abs(p.start - start) < 8000).map(p =>
      <p key={p.start} ref={node => { if (p.start === start) node?.scrollIntoView?.({ block: "nearest" }); }}
        className={`mb-2 whitespace-pre-wrap break-words ${p.start === start ? "bg-accent/15" : ""}`}>{p.text}</p>)}</div>
  </section>;
}
