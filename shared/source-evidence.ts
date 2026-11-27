/** Identifies a passage in the signed-in viewer's local document index. Excerpts are never chat commands. */
export interface SourceEvidence {
  coverage?: PdfCoverage;
  path: string; digest: string; start: number; page: number; paragraph: number; text: string;
}

export function encodedSourcePath(path: string) {
  return encodeURIComponent(path).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16));
}

export function sourceLink(digest: string, start: number, path: string) {
  return "#startupbot-source-" + digest + "-" + start + "/" + encodedSourcePath(path);
}

export function legacySourceRequest(text: string): boolean {
  return /\n\n\[1\]\(#startupbot-source-[a-f0-9]{64}-\d{1,9}\/[^\s)#]+\) · [^\n]+\n[\s\S]/u.test(text);
}

export interface PdfCoverage {
  pages: number;
  missing: number[];
}

/** Groups sorted one-based page numbers, as in Hermes tools/read_extract.py (_gap_map). */
export function missingPageRanges(missing: readonly number[]) {
  const ranges: { first: number; last: number }[] = [];
  for (const number of missing) {
    const previous = ranges.at(-1);
    if (previous && previous.last + 1 === number) previous.last = number;
    else ranges.push({ first: number, last: number });
  }
  return ranges.map(({ first, last }) => ({ first, label: last === first ? String(first) : first + "–" + last }));
}
