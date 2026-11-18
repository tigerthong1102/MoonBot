import { describe, expect, it } from "vitest";
import { compare, fields, guess, table, titles, type Cell, type Source } from "./compare";
import { htmlReport } from "./report";
const header = fields.map(f => titles[f]);
const source = (rows: Cell[][]): Source => ({ data: table([header, ...rows]), mapping: guess(header), separator: "." });
const scope = { company: "Đắk Lắk", period: "2025" };
const row = (doc: string, amount: Cell): Cell[] => [scope.company, scope.period, doc, amount];
describe("đối chiếu file", () => {
  it("separates companies and years, preserves IDs and exact scale", () => {
    const a = source([row("00017", "9007199254740993.0100"), ["B", "2025", "00017", "99"], ["Đắk Lắk", "2024", "00017", "99"]]);
    const b = source([row("00017", "9007199254740993.0099")]);
    const r = compare(a, b, scope);
    expect(r).toMatchObject({ leftCount: 1, rightCount: 1, difference: "0.0001" });
    expect(r.exceptions[0]).toMatchObject({ document: "00017", reason: "Lệch tiền", difference: "0.0001" });
  });
  it("detects missing, surplus and repeated documents even when the totals match", () => {
    const r = compare(source([row("1","1"),row("1","-1"),row("2","3")]), source([row("1","0"),row("3","3")]), scope);
    expect(r.difference).toBe("0");
    expect(r.exceptions.map(x => x.reason)).toEqual(["Nhiều dòng cùng số chứng từ","Thiếu ở báo cáo đối chứng","Thiếu ở tệp cần kiểm tra"]);
  });
  it("rejects missing scope, unbound columns, ambiguous text and unsafe Excel numeric data", () => {
    const valid = source([row("01","1")]);
    for (const value of ["1,000.00"," 123","1e8","1.0000000000001",{ numeric: "1234567890123456" }]) {
      expect(() => compare(source([row("01",value)]),valid,scope)).toThrow();
    }
    expect(() => compare(source([["","2025","01","1"]]),valid,scope)).toThrow();
    expect(() => compare(valid,valid,{...scope,company:"B"})).toThrow();
    expect(() => compare({...valid,mapping:{...valid.mapping, document:0}},valid,scope)).toThrow();
    expect(() => compare(source([[scope.company,scope.period,{ numeric:"17" },"1"]]),valid,scope)).toThrow();
  });
  it("supports explicit decimal comma and escapes identifiers in printable output", () => {
    const a = { ...source([row("<script>alert(1)</script>", "-1,2300")]), separator: "," as const };
    const r = compare(a, source([row("1","-1.2300")]), scope);
    expect(r.difference).toBe("0.0000");
    const report = htmlReport(r);
    expect(report).toContain("&lt;script&gt;");
    expect(report).not.toContain("<script>");
  });
});
