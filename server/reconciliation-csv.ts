import Papa from "papaparse";

export const RECONCILIATION_CSV_MAX_BYTES = 4 * 1024 * 1024;
const maxRows = 50_000, maxColumns = 128;
const formulaPrefix = /^[\s\p{Cc}\p{Cf}]*[=+@-]/u;
const signedNumber = /^[+-](?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?$/i;

function textCell(cell: string): string {
  const normalized = cell.normalize("NFKC");
  return formulaPrefix.test(normalized) && !signedNumber.test(cell.trim()) ? "'" + cell : cell;
}

export function reconciliationCsv(bytes: Buffer): { bytes: Buffer; changed: boolean } {
  const invalid = () => Object.assign(new Error("sources.csv must be a UTF-8 table with a header and consistent comma, semicolon, or tab-delimited rows."), { status: 400 });
  if (bytes.length > RECONCILIATION_CSV_MAX_BYTES) throw Object.assign(new Error("The reconciliation source table must fit in 4 MiB."), { status: 413 });
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw invalid(); }
  if (text.includes("\0") || /^\s*sep\s*=/i.test(text)) throw invalid();
  const rows: string[][] = [];
  let width = 0, changed = false, delimiter = ",", newline = "\n";
  Papa.parse<string[]>(text, {
    delimitersToGuess: [",", ";", "\t"], skipEmptyLines: true,
    step(result, parser) {
      const row = result.data;
      if (!rows.length) {
        width = row.length;
        delimiter = result.meta.delimiter;
        newline = result.meta.linebreak;
      }
      if (result.errors.length || width < 2 || width > maxColumns || row.length !== width || rows.length > maxRows) {
        parser.abort();
        throw invalid();
      }
      rows.push(row.map(cell => {
        const safe = textCell(cell);
        if (safe !== cell) changed = true;
        return safe;
      }));
    },
  });
  if (rows.length < 2) throw invalid();
  if (!changed) return { bytes, changed };
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? "\uFEFF" : "";
  const result = Buffer.from(bom + Papa.unparse(rows, { delimiter, newline, quotes: true }) + (text.endsWith(newline) ? newline : ""));
  if (result.length > RECONCILIATION_CSV_MAX_BYTES) throw Object.assign(new Error("The formula-safe reconciliation source table must fit in 4 MiB."), { status: 413 });
  return { bytes: result, changed };
}
