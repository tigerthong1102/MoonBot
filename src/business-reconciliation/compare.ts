import { ReconcileError, type MessageKey } from "./messages";
export type Cell = string | { numeric: string };
export type Table = { headers: string[]; rows: Cell[][] };
export const fields = ["company", "period", "document", "amount"] as const;
export type Mapping = Record<typeof fields[number], number>;
export const titles = { company: "Mã công ty", period: "Kỳ", document: "Số chứng từ", amount: "Số tiền" };
export const MAX_ROWS = 50_000;
const unit = 10n ** 12n;

export function table(lines: Cell[][]): Table {
  const [header, ...rows] = lines;
  if (!header?.length || !rows.length || rows.length > MAX_ROWS || header.length > 128) {
    throw new ReconcileError("reconcile.tableSize");
  }
  const headers = header.map(cell => {
    if (typeof cell !== "string" || !cell.trim()) throw new ReconcileError("reconcile.headerText");
    return cell.trim();
  });
  if (new Set(headers).size !== headers.length) throw new ReconcileError("reconcile.duplicateHeader");
  return { headers, rows };
}

export function guess(headers: string[]): Mapping {
  const index = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  return { company: index(titles.company), period: index(titles.period), document: index(titles.document), amount: index(titles.amount) };
}

export function checkMapping(t: Table, m: Mapping) {
  const values = fields.map(f => m[f]);
  if (!values.every(i => Number.isInteger(i) && i >= 0 && i < t.headers.length) || new Set(values).size !== fields.length) {
    throw new ReconcileError("reconcile.mapping");
  }
}

function identifier(cell: Cell | undefined, field: "company" | "period" | "document", line: number) {
  if (typeof cell !== "string" || !cell.trim() || cell.length > 256 || cell !== cell.trim() || /\p{Cc}/u.test(cell)) {
    throw new ReconcileError("reconcile.identifier", { line }, field);
  }
  return cell;
}

function sumValue(cell: Cell | undefined, separator: "." | ",", line: number) {
  const raw = typeof cell === "string" ? cell : cell?.numeric;
  const value = raw && (separator === "," && typeof cell === "string" ? raw.replace(",", ".") : raw);
  if (!raw || !value || (separator === "," && typeof cell === "string" && raw.includes(".")) ||
      !/^-?\d{1,26}(?:\.\d{1,12})?$/.test(value)) {
    throw new ReconcileError("reconcile.invalidAmount", { line });
  }
  if (typeof cell !== "string" && value.replace(/[-.]/g, "").replace(/^0+/, "").length > 15) {
    throw new ReconcileError("reconcile.numericPrecision");
  }
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const magnitude = BigInt(whole) * unit + BigInt(fraction.padEnd(12, "0"));
  return { value: value.startsWith("-") ? -magnitude : magnitude, scale: fraction.length };
}

function format(value: bigint, scale: number) {
  const abs = value < 0n ? -value : value;
  const whole = (abs / unit).toString();
  const fraction = (abs % unit).toString().padStart(12, "0").slice(0, scale);
  return (value < 0n ? "-" : "") + whole + (fraction ? "." + fraction : "");
}

export type Source = { data: Table; mapping: Mapping; separator: "." | "," };
export type Scope = { company: string; period: string };

function keys(row: Cell[], m: Mapping, index: number): Scope {
  const p = row[m.period];
  const period = typeof p === "object" && /^\d{4}$/.test(p.numeric) ? p.numeric : p;
  return { company: identifier(row[m.company], "company", index + 1), period: identifier(period, "period", index + 1) };
}

function collect(source: Source, scope: Scope) {
  const { data, mapping } = source;
  checkMapping(data, mapping);
  const documents = new Map<string, { count: number; total: bigint }>();
  let total = 0n, scale = 0, count = 0;
  data.rows.forEach((row, index) => {
    const key = keys(row, mapping, index);
    if (key.company !== scope.company || key.period !== scope.period) return;
    const doc = identifier(row[mapping.document], "document", index + 1);
    const amount = sumValue(row[mapping.amount], source.separator, index + 1);
    const record = documents.get(doc) ?? { count: 0, total: 0n };
    record.count++;
    record.total += amount.value;
    documents.set(doc, record);
    total += amount.value;
    count++;
    scale = Math.max(scale, amount.scale);
  });
  if (!count) throw new ReconcileError("reconcile.emptyScope");
  return { documents, count, total, scale };
}

export function compare(left: Source, right: Source, scope: Scope) {
  function read(source: Source, side: "left" | "right") {
    try { return collect(source, scope); }
    catch (e) { if (e instanceof ReconcileError) e.side = side; throw e; }
  }
  const a = read(left, "left"), b = read(right, "right");
  const scale = Math.max(a.scale, b.scale);
  const exceptions = [];
  for (const document of new Set([...a.documents.keys(), ...b.documents.keys()])) {
    const x = a.documents.get(document), y = b.documents.get(document);
    const reasons: MessageKey[] = [];
    if (!x) reasons.push("reconcile.missingLeft");
    if (!y) reasons.push("reconcile.missingRight");
    if (x && y && x.total !== y.total) reasons.push("reconcile.different");
    if ((x?.count ?? 0) > 1 || (y?.count ?? 0) > 1) reasons.push("reconcile.multiple");
    if (reasons.length) exceptions.push({ document, reasons, leftCount: x?.count ?? 0,
      rightCount: y?.count ?? 0, left: x ? format(x.total, scale) : "", right: y ? format(y.total, scale) : "",
      difference: format((x?.total ?? 0n) - (y?.total ?? 0n), scale) });
  }
  return { ...scope, leftCount: a.count, rightCount: b.count, left: format(a.total, scale),
    right: format(b.total, scale), difference: format(a.total - b.total, scale), exceptions };
}
