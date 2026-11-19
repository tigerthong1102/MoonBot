export interface WireElement {
  element_index: number;
  element_token?: string;
  role: string;
  label?: string;
  parent_index?: number;
  depth: number;
  /** The driver reported what the element holds; what it holds never leaves the bridge. */
  value_read?: true;
  /** Windows UIA projected this enabled button directly under the window it omitted. */
  uia_window_child?: true;
}
export interface WireApp { pid: number; name: string; bundle_id?: string; running?: boolean }
export interface WireWindow { window_id: number; pid?: number; title: string; app_name?: string }
export interface SlimStructured {
  elements?: WireElement[];
  apps?: WireApp[];
  windows?: WireWindow[];
  pid?: number;
  window_id?: number;
  bundle_id?: string;
  name?: string;
  app_name?: string;
  window_title?: string;
  /** The driver read the whole tree and every element survived slimming. */
  elements_complete?: true;
  background_accessibility_action?: true;
  background_effect_confirmed?: true;
  refusal?: { code?: string; message?: string };
}
export interface SlimResult { isError: boolean; rpcError?: true; structured?: SlimStructured }
export interface JournalEntry { tool: string; arguments: Record<string, unknown>; result: SlimResult }

export const MAX_ELEMENTS = 1500;

const ROOT_ROLES = new Set(["AXWindow", "AXApplication"]);

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

function pick(source: Rec, keys: readonly string[], types: Record<string, "string" | "number" | "boolean">): Rec {
  const out: Rec = {};
  for (const key of keys) if (typeof source[key] === types[key]) out[key] = source[key];
  return out;
}

const ELEMENT_TYPES = { element_index: "number", element_token: "string", role: "string", label: "string", parent_index: "number", depth: "number" } as const;
const APP_TYPES = { pid: "number", name: "string", bundle_id: "string", running: "boolean" } as const;
const WINDOW_TYPES = { window_id: "number", pid: "number", title: "string", app_name: "string" } as const;
const TOP_TYPES = { pid: "number", window_id: "number", bundle_id: "string", name: "string", app_name: "string", window_title: "string" } as const;

function slimList<T>(value: unknown, types: Record<string, "string" | "number" | "boolean">, required: readonly string[], max = Infinity, mark?: (raw: Rec, slim: Rec) => void): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: Rec[] = [];
  for (const item of value) {
    if (items.length >= max) break;
    if (!isRec(item)) continue;
    const slim = pick(item, Object.keys(types), types);
    mark?.(item, slim);
    if (required.every((key) => key in slim)) items.push(slim);
  }
  return items as T[];
}

const markValueRead = (raw: Rec, slim: Rec) => {
  if (typeof raw.value === "string") slim.value_read = true;
};

const COUNTS = ["element_count", "total_element_count", "returned_element_count", "filtered_element_count"] as const;
const hasText = (value: unknown) => typeof value === "string" && value.trim() !== "";
const countFits = (count: unknown, returned: number) => count === undefined || count === null || (typeof count === "number" && count <= returned);

export function wholeTree(state: Record<string, unknown>): boolean {
  const returned = Array.isArray(state.elements) ? state.elements.length : 0;
  return state.elements_complete === true && state.truncated !== true && !hasText(state.truncation_reason)
    && COUNTS.every((key) => countFits(state[key], returned));
}

export const treeDegraded = (state: Record<string, unknown>) => state.degraded === true || hasText(state.degraded_reason);

function markWindowButtons(raw: Rec, elements: WireElement[]): void {
  if (raw.tree_format !== "elements" || !Number.isSafeInteger(raw.pid) || !Number.isSafeInteger(raw.window_id)
    || !hasText(raw.window_title) || !Array.isArray(raw.elements)
    || raw.total_element_count !== elements.length || raw.returned_element_count !== elements.length
    || !COUNTS.every((key) => raw[key] === undefined || raw[key] === elements.length)) return;
  const rows = raw.elements;
  if (!rows.every((row) => isRec(row) && Number.isSafeInteger(row.depth) && Number(row.depth) >= 1
    && Number.isSafeInteger(row.element_index) && Number(row.element_index) >= 0
    && (row.parent_index === undefined || Number.isSafeInteger(row.parent_index))
    && (row.label === undefined || typeof row.label === "string"))
    || new Set(elements.map((row) => row.element_index)).size !== elements.length) return;
  const tokens = elements.flatMap((row) => row.element_token === undefined ? [] : [row.element_token]);
  if (new Set(tokens).size !== tokens.length) return;
  for (const [index, row] of elements.entries()) {
    if (row.role === "Button" && row.depth === 1 && row.parent_index === undefined && rows[index].enabled === true
      && /^s[0-9a-f]{8}:\d+$/u.test(row.element_token ?? "")) row.uia_window_child = true;
  }
}

export function backgroundAccessibilityAction(raw: Rec): boolean {
  return raw.route === "accessibility" && isRec(raw.delivery) && raw.delivery.mode === "background"
    && (raw.effect === "confirmed" || raw.effect === "unverifiable");
}

function slimStructured(raw: Rec, platform: NodeJS.Platform): SlimStructured {
  const out: SlimStructured = pick(raw, Object.keys(TOP_TYPES), TOP_TYPES);
  const elements = slimList<WireElement>(raw.elements, ELEMENT_TYPES, ["element_index", "role", "depth"], MAX_ELEMENTS, markValueRead);
  const apps = slimList<WireApp>(raw.apps, APP_TYPES, ["pid", "name"]);
  const windows = slimList<WireWindow>(raw.windows, WINDOW_TYPES, ["window_id", "title"]);
  if (elements) out.elements = elements;
  if (elements && elements.length === (raw.elements as unknown[]).length && wholeTree(raw) && !treeDegraded(raw)) {
    out.elements_complete = true;
    if (platform === "win32" && !raw.refusal) markWindowButtons(raw, elements);
  }
  if (platform === "win32" && backgroundAccessibilityAction(raw)) {
    out.background_accessibility_action = true;
    if (raw.effect === "confirmed") out.background_effect_confirmed = true;
  }
  if (apps) out.apps = apps;
  if (windows) out.windows = windows;
  if (isRec(raw.refusal)) {
    const refusal = pick(raw.refusal, ["code", "message"], { code: "string", message: "string" });
    out.refusal = refusal;
  }
  return out;
}

export function slimResponse(frame: unknown, platform: NodeJS.Platform = process.platform): SlimResult {
  if (!isRec(frame)) return { isError: true, rpcError: true };
  if (frame.error !== undefined) return { isError: true, rpcError: true };
  const result = isRec(frame.result) ? frame.result : {};
  const slim: SlimResult = { isError: result.isError === true };
  if (isRec(result.structuredContent)) slim.structured = slimStructured(result.structuredContent, platform);
  return slim;
}

export function elementPath(elements: readonly WireElement[], element: WireElement): string[] | null {
  const byIndex = new Map(elements.map((candidate) => [candidate.element_index, candidate]));
  const chain: string[] = [];
  const seen = new Set<number>([element.element_index]);
  let node = element;
  while (node.parent_index !== undefined) {
    const parent = byIndex.get(node.parent_index);
    if (!parent || seen.has(parent.element_index)) return null;
    seen.add(parent.element_index);
    if (!ROOT_ROLES.has(parent.role)) chain.push(`${parent.role}:${parent.label ?? ""}`);
    node = parent;
  }
  return node.depth > 0 ? null : chain.reverse();
}
