import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ZipReader, Uint8ArrayReader, TextWriter } from "@zip.js/zip.js";
import { buildZip } from "./testing/zip-fixture.ts";
import { verifyReconciliationDocument, verifiedReconciliationDocument } from "./reconciliation-document.ts";

const workbook = readFileSync(new URL("./testing/fixtures/reconciliation/reconciliation.xlsx", import.meta.url));
const pdf = readFileSync(new URL("./testing/fixtures/reconciliation/report.pdf", import.meta.url));

async function workbookWith(part: string, edit: (text: string) => string, extra?: string) {
  const reader = new ZipReader(new Uint8ArrayReader(workbook));
  try {
    const members = [];
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      const data = await entry.getData(new TextWriter());
      members.push({ name: entry.filename, data: entry.filename === part ? edit(data) : data });
    }
    if (extra) members.push({ name: extra, data: "fixture" });
    return buildZip(members);
  } finally { await reader.close(); }
}

describe("passive reconciliation documents", () => {
  it("preserves the exact workbook and PDF that carry numeric totals and source identifiers", async () => {
    for (const [kind, bytes] of [["xlsx", workbook], ["pdf", pdf]] as const) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      await verifyReconciliationDocument(kind, bytes);
      expect(verifiedReconciliationDocument(kind, bytes)).toBe(true);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
    }
  });

  it("refuses safe sample formulas, non-internal relationships, embedded parts and unknown worksheet instructions", async () => {
    for (const tampered of [
      await workbookWith("xl/worksheets/sheet1.xml", s => s.replace("<v>700</v>", "<f>SUM(300,400)</f><v>700</v>")),
      await workbookWith("xl/_rels/workbook.xml.rels", s => s.replace('Id="rId1"', 'TargetMode="External" Id="rId1"')),
      await workbookWith("xl/workbook.xml", s => s, "xl/embeddings/fixture.bin"),
      await workbookWith("xl/worksheets/sheet1.xml", s => s.replace("</worksheet>", "<futureFeature/></worksheet>")),
    ]) {
      await expect(verifyReconciliationDocument("xlsx", tampered)).rejects.toThrow(/value-only/);
      expect(verifiedReconciliationDocument("xlsx", tampered)).toBe(false);
    }
  });

  it("accepts the tagged structure attributes used by Chromium when printing a reconciliation table", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Source [2]: 700.00 - 650.00 = 50.00");
    const attrs = doc.context.obj([{ O: "Layout" }, { O: "Table" }]);
    const structure = doc.context.obj({ Type: "StructElem", S: "Table", A: attrs });
    doc.catalog.set(PDFName.of("StructTreeRoot"), doc.context.obj({ Type: "StructTreeRoot", K: structure }));
    await verifyReconciliationDocument("pdf", Buffer.from(await doc.save()));
  });

  it("refuses a fillable PDF, an attachment, an incomplete PDF and non-documents", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    doc.getForm().createTextField("Source note").addToPage(page);
    const interactive = Buffer.from(await doc.save());
    await expect(verifyReconciliationDocument("pdf", interactive)).rejects.toThrow(/static report/);
    const action = await PDFDocument.create();
    action.addPage();
    action.catalog.set(PDFName.of("OpenAction"), action.context.obj({ Type: "Action", S: "Named", N: "NextPage" }));
    expect(verifiedReconciliationDocument("pdf", Buffer.from(await action.save()))).toBe(false);
    const attached = await PDFDocument.create();
    attached.addPage();
    await attached.attach(Buffer.from("fixture"), "note.txt");
    for (const contents of [Buffer.from(await attached.save()), Buffer.from("%PDF-1.4\n%%EOF"), Buffer.from("no document")]) {
      expect(verifiedReconciliationDocument("pdf", contents)).toBe(false);
    }
  });
});
