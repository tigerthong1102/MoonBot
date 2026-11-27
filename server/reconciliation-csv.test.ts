import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Papa from "papaparse";
import { expect, it } from "vitest";
import { reconciliationCsv, RECONCILIATION_CSV_MAX_BYTES } from "./reconciliation-csv.ts";
import { incompleteReconciliation } from "./routine-deliverables.ts";

it.each([",", ";", "\t"])("reads complete quoted records and neutralizes formula-like cells in the %j dialect", delimiter => {
  const rows = [
    ["Source", "=heading", "Amount"],
    ['O’Brien, "A"\nsecond line', "  =SUM(1,2)", "-700"],
    ["＠fixture", "\t+example", "+22.50"],
    ["'already text", "@example", "42"],
  ];
  const raw = Buffer.from("\uFEFF" + Papa.unparse(rows, { delimiter, quotes: true, newline: "\r\n" }) + "\r\n");
  const safe = reconciliationCsv(raw);
  expect(safe.changed).toBe(true);
  expect(Papa.parse<string[]>(safe.bytes.toString(), { delimiter, skipEmptyLines: true }).data).toEqual([
    ["Source", "'=heading", "Amount"], ['O’Brien, "A"\nsecond line', "'  =SUM(1,2)", "-700"],
    ["'＠fixture", "'\t+example", "+22.50"], ["'already text", "'@example", "42"],
  ]);
  expect(reconciliationCsv(safe.bytes)).toEqual({ bytes: safe.bytes, changed: false });
});

it("rechecks every cell in an already staged attachment before publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "sources-csv-"));
  try {
    const path = join(directory, "sources.csv");
    const raw = Buffer.from("id,note\n" + "invoice,ordinary evidence\n".repeat(3_000) + "last,=1+2\n");
    const file = { kind: "file", name: "sources.csv", mime: "text/csv", path } as const;
    writeFileSync(path, raw);
    expect(incompleteReconciliation(directory, [file])).toContain("sources.csv");
    const safe = reconciliationCsv(raw);
    writeFileSync(path, safe.bytes);
    expect(incompleteReconciliation(directory, [file])).not.toContain("sources.csv");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("preserves safe source bytes and rejects malformed, non-UTF-8 and oversized input", () => {
  const csv = Buffer.from("source,amount\nINV-1,-700\n");
  expect(reconciliationCsv(csv)).toEqual({ bytes: csv, changed: false });
  for (const invalid of ['a,b\n"broken,x', "a,b\n1,2,3", "sep=;\na;b\nx;y", "a,b\n1,\0"]) {
    expect(() => reconciliationCsv(Buffer.from(invalid))).toThrow(/UTF-8 table/);
  }
  expect(() => reconciliationCsv(Buffer.from([0xff]))).toThrow(/UTF-8 table/);
  expect(() => reconciliationCsv(Buffer.alloc(RECONCILIATION_CSV_MAX_BYTES + 1))).toThrow(/4 MiB/);
});
