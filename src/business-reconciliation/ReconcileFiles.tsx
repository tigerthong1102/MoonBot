import { useRef, useState, type ComponentType, type SelectHTMLAttributes } from "react";
import { checkMapping, compare, fields, guess, table, titles, type Source } from "./compare";
import { readFileTable } from "./files";
import { htmlReport, type Report } from "./report";
import "./reconcile.css";

type Input = { source?: Source; name?: string; error?: string; busy?: boolean };
type Pair = [Input, Input];
const sides = ["Tệp cần kiểm tra", "Báo cáo đối chứng"] as const;

type Dropdown = "select" | ComponentType<Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">>;

export default function ReconcileFiles({ close, dropdown: Dropdown }: { close?: () => void; dropdown: Dropdown }) {
  const [inputs, setInputs] = useState<Pair>([{}, {}]);
  const versions = useRef([0, 0]);
  const [company, setCompany] = useState(""), [period, setPeriod] = useState("");
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState("");
  function clearReport() { setReport(undefined); setError(""); }
  function update(i: number, value: Input) {
    clearReport();
    setInputs(prev => i === 0 ? [value, prev[1]] : [prev[0], value]);
  }
  async function load(i: number, file?: File) {
    const version = ++versions.current[i];
    update(i, file ? { name: file.name, busy: true } : {});
    if (!file) return;
    try {
      const data = await readFileTable(file);
      if (version === versions.current[i]) update(i, { name: file.name, source: { data, mapping: guess(data.headers), separator: "." } });
    } catch (e) {
      if (version === versions.current[i]) update(i, { error: e instanceof Error ? e.message : "Không đọc được tệp." });
    }
  }
  function run() {
    clearReport();
    try {
      const a = inputs[0].source, b = inputs[1].source;
      if (!a || !b || !company.trim() || !period.trim()) throw new Error("Chọn hai tệp và điền mã công ty cùng kỳ cần kiểm tra.");
      setReport(compare(a, b, { company: company.trim(), period: period.trim() }));
    } catch (e) { setError(e instanceof Error ? e.message : "Chưa đối chiếu được."); }
  }
  function demo() {
    versions.current = versions.current.map(v => v + 1);
    const make = (rows: string[][]): Input => {
      const data = table([fields.map(f => titles[f]), ...rows]);
      return { name: "Dữ liệu mẫu", source: { data, mapping: guess(data.headers), separator: "." } };
    };
    setInputs([make([["CT01","2025","00017","120.0500"],["CT01","2025","00018","20"],["CT02","2025","00017","99"]]),
      make([["CT01","2025","00017","120.0400"],["CT01","2025","00019","20"]])]);
    setCompany("CT01"); setPeriod("2025"); clearReport();
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([htmlReport(report)], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "bao-cao-doi-chieu.html";
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const valid = inputs.every(input => {
    if (!input.source) return false;
    try { checkMapping(input.source.data, input.source.mapping); return true; } catch { return false; }
  });
  return <section className="reconciliation" lang="vi" aria-label="Đối chiếu chứng từ">
    <header><h1>Đối chiếu chứng từ</h1>{close && <button onClick={close}>Đóng</button>}</header>
    <p>Chọn hai tệp CSV UTF-8 hoặc XLSX một trang tính. Tệp được xử lý ngay trên máy.</p>
    <div className="reconcile-pair">{inputs.map((input, i) => <fieldset key={i}>
      <legend>{sides[i]}</legend>
      <label>Chọn tệp<input type="file" accept=".csv,.xlsx" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (file) void load(i, file);
      }}/></label>
      {input.name && <small>{input.name}{input.busy ? " · Đang đọc…" : ""}</small>}
      {input.error && <p role="alert">{input.error}</p>}
      {input.source && fields.map(f => <label key={f}>{titles[f]}<Dropdown aria-label={sides[i] + " · " + titles[f]} value={input.source!.mapping[f]} onChange={e => {
        const source = input.source!;
        update(i, { ...input, source: { ...source, mapping: { ...source.mapping, [f]: Number(e.target.value) } } });
      }}><option value={-1}>Chọn cột</option>{input.source!.data.headers.map((h, n) => <option key={n} value={n}>{h}</option>)}</Dropdown></label>)}
      {input.source && <label>Dấu thập phân<Dropdown value={input.source.separator} onChange={e => update(i, { ...input, source: { ...input.source!, separator: e.target.value as "." | "," } })}>
        <option value=".">Dấu chấm (1234.50)</option><option value=",">Dấu phẩy (1234,50)</option></Dropdown></label>}
    </fieldset>)}</div>
    <div className="reconcile-scope"><label>Mã công ty cần kiểm tra<input value={company} onChange={e => { setCompany(e.target.value); clearReport(); }}/></label>
      <label>Kỳ cần kiểm tra<input value={period} onChange={e => { setPeriod(e.target.value); clearReport(); }}/></label></div>
    <div className="reconcile-actions"><button className="primary" disabled={!valid || !company.trim() || !period.trim()} onClick={run}>Đối chiếu</button><button onClick={demo}>Dùng dữ liệu mẫu</button></div>
    {error && <p role="alert">{error}</p>}
    {report && <section aria-label="Kết quả"><h2>{report.exceptions.length} chứng từ cần kiểm tra</h2>
      <p>{report.company} · {report.period}<br/>Tệp: {report.left} ({report.leftCount} dòng) · Đối chứng: {report.right} ({report.rightCount} dòng)<br/>Chênh lệch: <b>{report.difference}</b></p>
      {report.exceptions.length > 0 && <div className="reconcile-scroll"><table><thead><tr><th>Số chứng từ</th><th>Lý do</th><th>Chênh lệch</th></tr></thead><tbody>
        {report.exceptions.slice(0, 100).map(x => <tr key={x.document}><td>{x.document}</td><td>{x.reason}</td><td>{x.difference}</td></tr>)}</tbody></table></div>}
      {report.exceptions.length > 100 && <p>Hiển thị 100 chứng từ đầu. Báo cáo tải về gồm toàn bộ kết quả.</p>}
      <button onClick={download}>Tải báo cáo HTML</button></section>}
  </section>;
}
