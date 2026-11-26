import type { Cell } from "./data-format";

export interface ChartMark {
  values: Array<[string, Cell]>;
  sourceRow?: number;
}

export function inspectDatum(datum: unknown, rows: Array<Record<string, Cell>>, rowKey: string): ChartMark | null {
  if (!datum || typeof datum !== "object") return null;
  const values = datum as Record<string, unknown>;
  const rowNumber = Number(values[rowKey]);
  const source = Number.isInteger(rowNumber) && rowNumber > 0 ? rows[rowNumber - 1] : undefined;
  const fields = Object.entries(source ?? values).filter((entry): entry is [string, Cell] =>
    entry[0] !== rowKey && (entry[1] === null || ["number", "string", "boolean"].includes(typeof entry[1])));
  return fields.length ? { values: fields, ...(source ? { sourceRow: rowNumber } : {}) } : null;
}

interface SceneNode { role?: string; marktype?: string; items?: SceneNode[]; datum?: unknown }

export function plottedData(scene: { root?: SceneNode }): unknown[] {
  const data: unknown[] = [];
  function visit(node: SceneNode) {
    if (node.role === "mark" && node.marktype && node.marktype !== "group") {
      for (const item of node.items ?? []) if (item.datum) data.push(item.datum);
    } else if (!node.role || node.marktype === "group") {
      for (const child of node.items ?? []) visit(child);
    }
  }
  if (scene.root) visit(scene.root);
  return data;
}
