// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js/index-native.js";
import { readFileTable } from "./files";

async function spreadsheet(sheet: string) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
  for (const [name, xml] of Object.entries({
    "xl/workbook.xml": '<workbook xmlns:r="urn:rel"><sheets><sheet name="Báo cáo" r:id="s1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="s1" Type="urn:office/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData>" + sheet + "</sheetData></worksheet>",
  })) await writer.add(name, new TextReader(xml));
  return new File([new Uint8Array(await (await writer.close()).arrayBuffer())], "sample.xlsx");
}
describe("file consent boundary", () => {
  it("reads UTF-8 BOM CSV without coercing values", async () => {
    const t = await readFileTable(new File(["\uFEFFMã,Số tiền\r\n0001,\"123,0100\"\r\n"], "a.csv"));
    expect(t.rows).toEqual([["0001","123,0100"]]);
  });
  it("rejects malformed UTF-8, ragged CSV and duplicate headers", async () => {
    for (const input of [new Uint8Array([255]), "a,b\n1,2,3", "a,a\n1,2"]) {
      await expect(readFileTable(new File([input],"a.csv"))).rejects.toThrow();
    }
  });
  it("retains XLSX cell types and original numeric text", async () => {
    const file = await spreadsheet('<row><c r="A1" t="inlineStr"><is><t>Mã</t></is></c><c r="B1" t="inlineStr"><is><t>Tiền</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>00017</t></is></c><c r="B2"><v>12.0400</v></c></row>');
    expect((await readFileTable(file)).rows).toEqual([["00017", { numeric: "12.0400" }]]);
  });
  it("rejects cached formula values", async () => {
    await expect(readFileTable(await spreadsheet('<row><c r="A1"><f>1+1</f><v>2</v></c></row>'))).rejects.toThrow(/công thức/);
  });
});
