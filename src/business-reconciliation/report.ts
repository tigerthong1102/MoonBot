import type { compare } from "./compare";
import type { MessageKey, Translate } from "./messages";
import type { SheetRows } from "./compare";

export function sourceRows(source?: SheetRows): string {
  return source ? source.sheet + " [" + source.rows.join(", ") + "]" : "";
}

export type Report = ReturnType<typeof compare>;
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function htmlReport(r: Report, t: Translate, lang: string) {
  const headings: MessageKey[] = ["reconcile.document", "reconcile.reason", "reconcile.leftRows", "reconcile.rightRows", "reconcile.leftAmount", "reconcile.rightAmount", "reconcile.difference"];
  const header = headings.map(key => "<th>" + escape(t(key)) + "</th>").join("");
  const rows = r.exceptions.map(x => {
    const values = [x.document, x.reasons.map(key => t(key)).join(", "), [x.leftCount, sourceRows(x.leftSource)].filter(x => x !== "").join(" · "), [x.rightCount, sourceRows(x.rightSource)].filter(x => x !== "").join(" · "), x.left, x.right, x.difference];
    return "<tr>" + values.map(value => "<td>" + escape(value) + "</td>").join("") + "</tr>";
  }).join("");
  const title = escape(t("reconcile.reportTitle"));
  const totals = [
    t("reconcile.fileTotal", { amount: r.left, rows: r.leftCount }),
    t("reconcile.referenceTotal", { amount: r.right, rows: r.rightCount }),
    t("reconcile.difference") + ": " + r.difference,
  ];
  return `<!doctype html><html lang="${escape(lang)}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title>` +
    '<style>body{font:16px system-ui;margin:3em}table{border-collapse:collapse}td,th{padding:.5em;border:1px solid;text-align:left}</style>' +
    "<h1>" + title + "</h1><p>" + escape(t("reconcile.company")) + " <strong>" + escape(r.company) + "</strong> · " + escape(t("reconcile.period")) + " " + escape(r.period) + "</p>" +
    "<p>" + totals.map(escape).join("<br>") + "</p><h2>" + escape(t("reconcile.count", { count: r.exceptions.length })) + "</h2>" +
    (rows ? "<table><thead><tr>" + header + "</tr></thead><tbody>" + rows + "</tbody></table>" : "<p>" + escape(t("reconcile.matched")) + "</p>") + "</html>";
}
