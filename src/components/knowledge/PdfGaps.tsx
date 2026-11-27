import { useState } from "react";
import { t } from "@/lib/i18n";
import { missingPageRanges } from "../../../shared/source-evidence";
import { Select } from "../Select";
import { SourcePdf } from "./SourcePdf";
import type { SourceDocument } from "./source-index";

export function PdfGaps({ doc }: { doc: SourceDocument }) {
  const [selected, select] = useState<number>();
  if (!doc.coverage?.missing.length) return null;
  const ranges = missingPageRanges(doc.coverage.missing);
  const label = t("knowledge.pdfGaps", { pages: ranges.map(range => range.label).join(", ") });
  const page = selected ?? ranges[0]!.first;
  return <details className="my-2">
    <summary className="break-words">{doc.path} · {label}</summary>
    {ranges.length > 1 && <Select size="sm" aria-label={label} value={page} onChange={event => select(Number(event.target.value))}>
      {ranges.map(range => <option key={range.first} value={range.first}>{range.label}</option>)}
    </Select>}
    <SourcePdf key={page} file={doc.file} path={doc.path} page={page} />
  </details>;
}
