import { SaxesParser, type SaxesTagNS } from "saxes";
import { posix } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { zipDirectoryLocation, zipMembers } from "./zip-archive.ts";

const sheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const packageRel = "http://schemas.openxmlformats.org/package/2006/relationships";
const contentNs = "http://schemas.openxmlformats.org/package/2006/content-types";
const sheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml.";
const xmlType = "application/xml";
const relsType = "application/vnd.openxmlformats-package.relationships+xml";
const sheets = /^xl\/worksheets\/sheet\d+\.xml$/;
const themes = /^xl\/theme\/theme\d+\.xml$/;
const types: Record<string, string> = {
  "xl/workbook.xml": sheetType + "sheet.main+xml", "xl/styles.xml": sheetType + "styles+xml", "xl/sharedStrings.xml": sheetType + "sharedStrings+xml",
  "docProps/app.xml": "application/vnd.openxmlformats-officedocument.extended-properties+xml", "docProps/core.xml": "application/vnd.openxmlformats-package.core-properties+xml",
};
function partType(name: string) {
  if (sheets.test(name)) return sheetType + "worksheet+xml";
  if (themes.test(name)) return "application/vnd.openxmlformats-officedocument.theme+xml";
  if (name === "_rels/.rels" || name === "xl/_rels/workbook.xml.rels") return relsType;
  if (name === "[Content_Types].xml") return xmlType;
  return Object.hasOwn(types, name) ? types[name] : undefined;
}
function invalid(): never { throw new Error("Use a value-only reconciliation workbook with numeric totals, plain source references and internal worksheet links."); }

function elements(text: string) {
  const nodes: SaxesTagNS[] = [];
  let depth = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", invalid);
  parser.on("processinginstruction", invalid);
  parser.on("xmldecl", decl => { if (decl.encoding && !/^utf-?8$/i.test(decl.encoding)) invalid(); });
  parser.on("opentag", tag => {
    if (++depth > 64 || nodes.length >= 200_000) invalid();
    nodes.push(tag);
  });
  parser.on("closetag", () => { depth--; });
  parser.write(text).close();
  if (!nodes.length) invalid();
  return nodes;
}
function attr(node: SaxesTagNS, name: string) { return node.attributes[name]?.value ?? ""; }

function xmlParts(bytes: Buffer) {
  const directory = zipDirectoryLocation(bytes, 0, 256);
  if (bytes.length < 22 || bytes.readUInt32LE(bytes.length - 22) !== 0x06054b50 || directory.directoryOffset + directory.directoryBytes !== bytes.length - 22) invalid();
  const central = bytes.subarray(directory.directoryOffset, directory.directoryOffset + directory.directoryBytes);
  const parts = new Map<string, SaxesTagNS[]>();
  let total = 0, previousEnd = 0;
  const members = zipMembers(central, directory.entryCount).sort((a,b) => a.localHeaderOffset - b.localHeaderOffset);
  for (const member of members) {
    const { name, compression, compressedBytes, uncompressedBytes, localHeaderOffset: offset } = member;
    if (!partType(name) || parts.has(name) || uncompressedBytes > 6 * 1024 * 1024 || (total += uncompressedBytes) > 16 * 1024 * 1024) invalid();
    const header = bytes.subarray(offset, offset + 30);
    if (offset !== previousEnd || header.length !== 30 || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== compression || (header.readUInt16LE(6) & 1)) invalid();
    const start = offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    previousEnd = start + compressedBytes;
    if (previousEnd > directory.directoryOffset || bytes.subarray(offset + 30, offset + 30 + header.readUInt16LE(26)).toString("utf8") !== name) invalid();
    const packed = bytes.subarray(start, previousEnd);
    const data = compression === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, uncompressedBytes) });
    if (data.length !== uncompressedBytes || crc32(data) !== member.crc32) invalid();
    if (header.readUInt16LE(6) & 8) {
      if (bytes.readUInt32LE(previousEnd) === 0x08074b50) previousEnd += 4;
      if (bytes.readUInt32LE(previousEnd) !== member.crc32 || bytes.readUInt32LE(previousEnd + 4) !== compressedBytes || bytes.readUInt32LE(previousEnd + 8) !== uncompressedBytes) invalid();
      previousEnd += 12;
    } else if (header.readUInt32LE(14) !== member.crc32 || header.readUInt32LE(18) !== compressedBytes || header.readUInt32LE(22) !== uncompressedBytes) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    parts.set(name, elements(text));
  }
  if (previousEnd !== directory.directoryOffset) invalid();
  return parts;
}

const sheetElements = new Set(("worksheet sheetPr outlinePr pageSetUpPr dimension sheetViews sheetView selection pane sheetFormatPr cols col sheetData row c v is t r rPr rFont charset family b i strike outline shadow condense extend color sz u vertAlign scheme phoneticPr rPh sheetProtection mergeCells mergeCell pageMargins pageSetup printOptions headerFooter oddHeader oddFooter evenHeader evenFooter firstHeader firstFooter autoFilter filterColumn filters filter sheetCalcPr").split(" "));
const workbookElements = new Set("workbook fileVersion workbookPr bookViews workbookView sheets sheet definedNames calcPr workbookProtection".split(" "));
const stringElements = new Set("sst si t r rPr rFont charset family b i strike outline shadow condense extend color sz u vertAlign scheme phoneticPr rPh".split(" "));

export function passiveWorkbook(bytes: Buffer): boolean {
  const parts = xmlParts(bytes);
  const workbook = parts.get("xl/workbook.xml"), content = parts.get("[Content_Types].xml");
  const root = parts.get("_rels/.rels"), links = parts.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !content || !root || !links || content[0]!.uri !== contentNs || content[0]!.local !== "Types") return false;
  const overrides = new Set<string>();
  for (const node of content.slice(1)) {
    const type = attr(node, "ContentType");
    if (node.uri !== contentNs) return false;
    if (node.local === "Default") {
      if (!((attr(node, "Extension") === "xml" && type === xmlType) || (attr(node, "Extension") === "rels" && type === relsType))) return false;
    } else {
      const name = attr(node, "PartName").replace(/^\//, "");
      if (node.local !== "Override" || !parts.has(name) || overrides.has(name) || partType(name) !== type) return false;
      overrides.add(name);
    }
  }
  const linkedSheets = new Set<string>(), ids = new Set<string>();
  let linkedBook = false;
  for (const [doc, base] of [[root, ""], [links, "xl"]] as const) {
    if (doc[0]!.uri !== packageRel || doc[0]!.local !== "Relationships") return false;
    const relationIds = new Set<string>();
    for (const node of doc.slice(1)) {
      const target = attr(node, "Target"), kind = attr(node, "Type"), id = attr(node, "Id");
      if (node.uri !== packageRel || node.local !== "Relationship" || !id || relationIds.has(id) || !["","Internal"].includes(attr(node, "TargetMode")) || /[\\:#?%]|^\/\//.test(target)) return false;
      relationIds.add(id);
      const name = posix.resolve("/", base, target).slice(1);
      if (!parts.has(name) || !overrides.has(name)) return false;
      if (!base) {
        if (name === "xl/workbook.xml" && kind === officeRel + "officeDocument") linkedBook = true;
        else if (!(name === "docProps/app.xml" && kind === officeRel + "extended-properties") && !(name === "docProps/core.xml" && kind === packageRel + "/metadata/core-properties")) return false;
      } else if (sheets.test(name) && kind === officeRel + "worksheet") { ids.add(id); linkedSheets.add(name); }
      else if (!(themes.test(name) && kind === officeRel + "theme") && !(name === "xl/styles.xml" && kind === officeRel + "styles") && !(name === "xl/sharedStrings.xml" && kind === officeRel + "sharedStrings")) return false;
    }
  }
  if (!linkedBook || !ids.size || workbook[0]!.local !== "workbook") return false;
  for (const [name, doc] of parts) {
    const allowed = name === "xl/workbook.xml" ? workbookElements : sheets.test(name) ? sheetElements : name === "xl/sharedStrings.xml" ? stringElements : undefined;
    if (sheets.test(name) && (!linkedSheets.has(name) || doc[0]!.local !== "worksheet")) return false;
    for (const node of doc) {
      if (allowed && (node.uri !== sheetNs || !allowed.has(node.local))) return false;
      if (node.local === "sheet" && !ids.delete(Object.values(node.attributes).find(a => a.uri === officeRel.slice(0, -1) && a.local === "id")?.value ?? "")) return false;
      if (/^(ext|extLst|externalReference|formula|f|hyperlink|definedName|hlinkClick|hlinkHover|oleObject|DDEItem|AlternateContent)$/i.test(node.local)) return false;
      if (node.local === "c" && !["", "s", "n", "b", "d", "e", "inlineStr", "str"].includes(attr(node, "t"))) return false;
    }
  }
  return ids.size === 0;
}
