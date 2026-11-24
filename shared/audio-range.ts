/** `none`: answer as if no Range header (absent, malformed, non-bytes, multi-range); `unsatisfiable`: a start at or past EOF, answered 416. */
export type AudioRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

/** Honours only `a-b`, `a-` and `-n`; anything else gets the whole file, always a correct answer to a GET. */
export function parseAudioRange(header: string | undefined, size: number): AudioRange {
  const raw = header?.trim();
  if (!raw) return { kind: "none" };
  const m = raw.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return { kind: "none" };
  const [, rawStart, rawEnd] = m;
  if (rawStart === "") {
    // `bytes=-` is malformed, not a suffix range; `bytes=-0` is unsatisfiable per RFC 9110.
    if (rawEnd === "") return { kind: "none" };
    const suffix = Number(rawEnd);
    if (!suffix) return { kind: "unsatisfiable" };
    if (size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (start >= size) return { kind: "unsatisfiable" };
  if (rawEnd === "") return { kind: "range", start, end: size - 1 };
  const end = Number(rawEnd);
  if (end < start) return { kind: "none" };
  return { kind: "range", start, end: Math.min(end, size - 1) };
}
