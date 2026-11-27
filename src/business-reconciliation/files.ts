import { ReconcileError } from "./messages";
import Papa from "papaparse";
import { BlobReader, ZipReader, type FileEntry } from "@zip.js/zip.js/index-native.js";
import { spreadsheetML } from "./spreadsheetml";
import { MAX_ROWS, table, type Cell, type Table } from "./compare";

const MB = 1024 * 1024;
const utf8 = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

function csv(text: string): Table {
  const lines: string[][] = [];
  Papa.parse<string[]>(text, { delimitersToGuess: [",", ";", "\t"], skipEmptyLines: true,
    step(result, parser) {
      if (result.errors.length || lines.length > MAX_ROWS || result.data.length > 128) {
        parser.abort();
        throw new ReconcileError("reconcile.csvShape");
      }
      lines.push(result.data);
    },
  });
  const width = lines[0]?.length;
  if (lines.some(row => row.length !== width)) throw new ReconcileError("reconcile.csvWidth");
  return table(lines);
}

const descendants = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagName("*")).filter(el => el.localName === tag);
const textRuns = (node: Element) => descendants(node, "t").filter(t => !t.closest("rPh")).map(t => t.textContent ?? "").join("");

async function workbook(file: File): Promise<Table> {
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    const entries = new Map<string, FileEntry>();
    let size = 0, count = 0, expanded = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > 256 || entry.encrypted || entry.filename.includes("..") || /vbaProject|externalLinks|embeddings/i.test(entry.filename)) {
        throw new ReconcileError("reconcile.archiveContent");
      }
      if (entry.directory) continue;
      size += entry.uncompressedSize;
      if (size > 16 * MB || entry.uncompressedSize > 6 * MB || entries.has(entry.filename)) throw new ReconcileError("reconcile.archiveSize");
      entries.set(entry.filename, entry);
    }
    async function xml(name: string) {
      const entry = entries.get(name);
      if (!entry) throw new ReconcileError("reconcile.missingPart");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
        bytes += chunk.byteLength;
        expanded += chunk.byteLength;
        if (bytes > entry.uncompressedSize || bytes > 6 * MB || expanded > 16 * MB) throw new ReconcileError("reconcile.expandedSize");
        chunks.push(chunk);
      } }), { checkSignature: true, useWebWorkers: false });
      const buffer = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      const value = utf8(buffer);
      if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new ReconcileError("reconcile.xmlDeclaration");
      const doc = new DOMParser().parseFromString(value, "application/xml");
      if (descendants(doc, "parsererror").length) throw new ReconcileError("reconcile.xmlInvalid");
      return doc;
    }
    const book = await xml("xl/workbook.xml");
    const rels = descendants(await xml("xl/_rels/workbook.xml.rels"), "Relationship");
    const strings = entries.has("xl/sharedStrings.xml") ? descendants(await xml("xl/sharedStrings.xml"), "si").map(textRuns) : [];
    const visible = descendants(book, "sheet").filter(s => !s.hasAttribute("state") || s.getAttribute("state") === "visible");
    if (visible.length !== 1) throw new ReconcileError("reconcile.visibleSheet");
    const sheet = visible[0];
    const id = sheet.getAttribute("r:id");
    const rel = rels.find(r => r.getAttribute("Id") === id && r.getAttribute("Type")?.endsWith("/worksheet"));
    const target = rel?.getAttribute("Target")?.replace(/^\/xl\//, "");
    if (!target || !/^worksheets\/[\w.-]+\.xml$/.test(target) || rel?.getAttribute("TargetMode") === "External") throw new ReconcileError("reconcile.sheetPath");
    const doc = await xml("xl/" + target);
    if (descendants(doc, "f").length || descendants(doc, "mergeCell").length) throw new ReconcileError("reconcile.flatSheet");
    const data = descendants(doc, "sheetData")[0];
    if (!data) throw new ReconcileError("reconcile.emptySheet");
    const lines: Cell[][] = [];
    for (const row of data.children) {
      const cells: Cell[] = [];
      for (const cell of row.children) {
        if (cell.localName !== "c") continue;
        const ref = /^([A-Z]{1,3})[1-9]\d*$/.exec(cell.getAttribute("r") ?? "");
        if (!ref) throw new ReconcileError("reconcile.cellAddress");
        let col = 0;
        for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64;
        if (col > 128 || col <= cells.length) throw new ReconcileError("reconcile.cellOrder");
        while (cells.length < col - 1) cells.push("");
        const val = descendants(cell, "v")[0]?.textContent ?? "";
        const type = cell.getAttribute("t") ?? "n";
        if (type === "s" && /^\d+$/.test(val) && strings[Number(val)] !== undefined) cells.push(strings[Number(val)]);
        else if (type === "inlineStr") cells.push(textRuns(cell));
        else if (type === "n") cells.push(val ? { numeric: val } : "");
        else if (type === "str") cells.push(val);
        else throw new ReconcileError("reconcile.cellType");
      }
      if (cells.some(c => c !== "")) lines.push(cells);
      if (lines.length > MAX_ROWS + 1) throw new ReconcileError("reconcile.sheetRows");
    }
    if (lines.some(row => row.length > lines[0].length)) throw new ReconcileError("reconcile.sheetWidth");
    return table(lines);
  } finally { await reader.close(); }
}

export async function readFileTable(file: File): Promise<Table> {
  if (!file.size || file.size > 4 * MB) throw new ReconcileError("reconcile.fileSize");
  if (/\.csv$/i.test(file.name)) return csv(utf8(new Uint8Array(await file.arrayBuffer())));
  if (/\.xlsx$/i.test(file.name)) return workbook(file);
  if (/\.(xls|xml)$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new ReconcileError("reconcile.legacyXml");
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    return spreadsheetML(new TextDecoder(encoding, { fatal: true }).decode(bytes));
  }
  throw new ReconcileError("reconcile.fileType");
}
