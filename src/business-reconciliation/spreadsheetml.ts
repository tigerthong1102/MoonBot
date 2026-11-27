import { MAX_ROWS, table, type Cell, type Table } from "./compare";
import { ReconcileError } from "./messages";

const spreadsheet = "urn:schemas-microsoft-com:office:spreadsheet";
const excel = "urn:schemas-microsoft-com:office:excel";
const children = (parent: Element, name: string) => Array.from(parent.children).filter(el => el.localName === name && el.namespaceURI === spreadsheet);
function attr(el: Element, name: string): string | null {
  const value = el.getAttributeNS(spreadsheet, name);
  if (value !== null || !el.hasAttribute("ss:" + name)) return value;
  for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
    const ns = ancestor.getAttribute("xmlns:ss");
    if (ns !== null) return ns === spreadsheet ? el.getAttribute("ss:" + name) : null;
  }
  return null;
}

function address(explicit: string | null, previous: number, max: number): number {
  if (explicit === null) return previous + 1;
  const value = Number(explicit);
  if (!/^[1-9]\d*$/.test(explicit) || !Number.isSafeInteger(value) || value <= previous || value > max) throw new ReconcileError("reconcile.cellOrder");
  return value;
}

export function spreadsheetML(text: string): Table {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ReconcileError("reconcile.xmlDeclaration");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "Workbook" || root.namespaceURI !== spreadsheet || doc.getElementsByTagName("parsererror").length) {
    throw new ReconcileError("reconcile.legacyXml");
  }
  const visible = children(root, "Worksheet").filter(sheet => {
    const visibility = sheet.getElementsByTagNameNS(excel, "Visible")[0]?.textContent;
    return !visibility || visibility === "SheetVisible";
  });
  if (visible.length !== 1) throw new ReconcileError("reconcile.visibleSheet");
  const sheet = visible[0], name = attr(sheet, "Name");
  const tables = children(sheet, "Table");
  if (!name || name.length > 128 || tables.length !== 1) throw new ReconcileError("reconcile.emptySheet");
  const lines: Cell[][] = [], sourceRows: number[] = [];
  const grid = tables[0];
  let rowNumber = address(attr(grid, "TopCell"), 0, 65_536) - 1;
  if (address(attr(grid, "LeftCell"), 0, 128) !== 1) throw new ReconcileError("reconcile.flatSheet");
  for (const row of children(tables[0], "Row")) {
    rowNumber = address(attr(row, "Index"), rowNumber, 65_536);
    if (rowNumber > 65_536) throw new ReconcileError("reconcile.sheetRows");
    const cells: Cell[] = [];
    for (const cell of children(row, "Cell")) {
      if (["Formula", "MergeAcross", "MergeDown", "ArrayRange"].some(key => attr(cell, key) !== null)) throw new ReconcileError("reconcile.flatSheet");
      const col = address(attr(cell, "Index"), cells.length, 128);
      if (col > 128) throw new ReconcileError("reconcile.cellOrder");
      while (cells.length < col - 1) cells.push("");
      const data = children(cell, "Data");
      if (!data.length) { cells.push(""); continue; }
      if (data.length !== 1) throw new ReconcileError("reconcile.cellType");
      const type = attr(data[0], "Type"), value = data[0].textContent ?? "";
      if (type === "Number") cells.push({ numeric: value });
      else if (type === "String" || type === "DateTime") cells.push(value);
      else throw new ReconcileError("reconcile.cellType");
    }
    if (cells.every(c => c === "")) continue;
    sourceRows.push(rowNumber);
    lines.push(cells);
    if (lines.length > MAX_ROWS + 1) throw new ReconcileError("reconcile.sheetRows");
  }
  if (lines.some(row => row.length > lines[0].length)) throw new ReconcileError("reconcile.sheetWidth");
  return { ...table(lines), origin: { sheet: name, rows: sourceRows.slice(1) } };
}
