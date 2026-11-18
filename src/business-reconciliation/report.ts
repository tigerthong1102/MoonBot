import { compare } from "./compare";
export type Report = ReturnType<typeof compare>;
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function htmlReport(r: Report) {
  const cell = (v: string | number) => "<td>" + escape(v) + "</td>";
  const rows = r.exceptions.map(x => "<tr>" + [x.document, x.reason, x.leftCount, x.rightCount, x.left, x.right, x.difference].map(cell).join("") + "</tr>").join("");
  return '<!doctype html><html lang="vi"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Báo cáo đối chiếu</title>' +
    '<style>body{font:16px system-ui;margin:3em;color:#152522}table{border-collapse:collapse}td,th{padding:.5em;border:1px solid #aab8b4;text-align:left}</style>' +
    "<h1>Báo cáo đối chiếu chứng từ</h1><p>Công ty <strong>" + escape(r.company) + "</strong> · Kỳ " + escape(r.period) + "</p>" +
    "<p>Tệp cần kiểm tra (" + r.leftCount + " dòng): " + r.left + "<br>Báo cáo đối chứng (" + r.rightCount + " dòng): " + r.right +
    "<br>Chênh lệch (tệp trừ đối chứng): " + r.difference + "</p><h2>" + r.exceptions.length + " chứng từ cần kiểm tra</h2>" +
    (rows ? "<table><thead><tr><th>Số chứng từ</th><th>Lý do</th><th>Dòng tệp</th><th>Dòng đối chứng</th><th>Tiền tệp</th><th>Tiền đối chứng</th><th>Chênh lệch</th></tr></thead><tbody>" + rows + "</tbody></table>" : "<p>Khớp số chứng từ và số tiền trong phạm vi đã chọn.</p>") + "</html>";
}
