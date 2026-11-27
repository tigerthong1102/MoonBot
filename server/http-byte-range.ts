/** The bytes a Range header asks of a file this size, or null when it can't be met. */
export function rangeOf(header: string, size: number): { start: number; end: number } | null {
  const range = /^bytes=(\d*)-(\d*)$/.exec(header);
  const start = range?.[1] ? Number(range[1]) : range?.[2] ? Math.max(0, size - Number(range[2])) : NaN;
  const end = range?.[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  return !range || !Number.isSafeInteger(start) || start >= size || end < start ? null : { start, end };
}
