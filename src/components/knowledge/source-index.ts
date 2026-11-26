import { sha256Hex } from "../../lib/sha256";

export const accepts = /\.(txt|md|markdown|csv|tsv|pdf)$/i;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_LIBRARY = 16 * 1024 * 1024;
const MAX_FILES = 300;
export type SourceFile = { path: string; file: File } | { path: string; file?: undefined };
export interface Passage { page: number; paragraph: number; text: string; start: number }
export interface SourceDocument { path: string; digest: string; file: File; passages: Passage[] }
export type SourceChange = { path: string; state: "added" | "changed" | "removed" | "error"; at?: number; issue?: "missing" | "signedOut" | "offline" | "folder" };
export interface Index { docs: Map<string, SourceDocument>; changes: SourceChange[] }
export interface Directory {
  name: string;
  values(): AsyncIterable<Directory & { kind: "directory" } | { name: string; kind: "file"; getFile(): Promise<File> }>;
}

export async function scanFolder(root: Directory, signal?: AbortSignal): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  let entries = 0;
  async function scan(dir: Directory, prefix: string, depth: number) {
    signal?.throwIfAborted();
    if (depth > 20) throw new Error("folder limit");
    for await (const child of dir.values()) {
      signal?.throwIfAborted();
      if (++entries > 10_000) throw new Error("folder limit");
      if (child.name.startsWith(".") || child.name === "node_modules") continue;
      const path = prefix + child.name;
      if (child.kind === "directory") await scan(child, path + "/", depth + 1);
      else if (accepts.test(child.name)) {
        if (files.length >= MAX_FILES) throw new Error("folder limit");
        try { files.push({ path, file: await child.getFile() }); } catch { files.push({ path }); }
        signal?.throwIfAborted();
      }
    }
  }
  await scan(root, root.name + "/", 0);
  return files;
}

export function splitPassages(text: string): Passage[] {
  const passages: Passage[] = [];
  let page = 1;
  let start = 0;
  for (const sheet of text.split("\f")) {
    let paragraph = 0;
    for (const match of sheet.matchAll(/[^\s][\s\S]*?(?=\r?\n[ \t]*\r?\n|$)/g)) {
      const block = match[0].trimEnd();
      paragraph++;
      for (let n = 0; n < block.length; n += 1400) {
        if (passages.length >= 10_000) throw new Error("passage limit");
        passages.push({ page, paragraph, text: block.slice(n, n + 1400), start: start + match.index + n });
      }
    }
    start += sheet.length + 1;
    page++;
  }
  return passages;
}

export async function indexSources(files: SourceFile[], previous: Index, signal?: AbortSignal): Promise<Index> {
  signal?.throwIfAborted();
  const supported = files.filter(entry => accepts.test(entry.path));
  if (supported.length > MAX_FILES || supported.reduce((total, e) => total + (e.file?.size ?? 0), 0) > MAX_LIBRARY)
    throw new Error("library limit");
  const docs = new Map<string, SourceDocument>();
  const changes: SourceChange[] = [];
  const paths = new Set<string>();
  let textSize = 0, passageCount = 0;
  for (const { path, file } of supported) {
    signal?.throwIfAborted();
    if (paths.has(path)) throw new Error("duplicate file");
    paths.add(path);
    try {
      if (!file) throw new Error("file unavailable");
      const pdf = /\.pdf$/i.test(path);
      if (file.size > (pdf ? 12 * 1024 * 1024 : MAX_FILE)) throw new Error("file limit");
      const bytes = await file.arrayBuffer();
      signal?.throwIfAborted();
      const digest = await sha256Hex(bytes);
      signal?.throwIfAborted();
      const saved = previous.docs.get(path);
      let doc = saved;
      if (!doc || doc.digest !== digest) {
        const text = pdf ? await (await import("./pdf-text")).pdfText(bytes) : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0")) throw new Error("binary file");
        doc = { path, digest, file, passages: splitPassages(text) };
      }
      const size = doc.passages.reduce((total, p) => total + p.text.length, 0);
      if (textSize + size > 12 * 1024 * 1024 || passageCount + doc.passages.length > 40_000) throw new Error("index limit");
      textSize += size; passageCount += doc.passages.length;
      docs.set(path, doc);
      if (doc !== saved) changes.push({ path, state: saved ? "changed" : "added" });
    } catch { signal?.throwIfAborted(); changes.push({ path, state: "error" }); }
  }
  for (const path of previous.docs.keys()) if (!paths.has(path)) changes.push({ path, state: "removed" });
  return { docs, changes };
}

const fold = (value: string) => value.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
const continuousScript = /((?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30fc\uff70][\p{M}\uff9e\uff9f]*)+)/u;
let segmenter: Intl.Segmenter | undefined;
function cjkNgrams(text: string, indexing: boolean): string[] {
  const letters = text.match(/\P{M}\p{M}*/gu) ?? [];
  if (letters.length <= 1) return letters;
  const pairs = letters.slice(1).map((letter, index) => letters[index] + letter);
  return indexing ? [...letters, ...pairs] : pairs;
}

function wordsOf(value: string, indexing = false) {
  return value.split(continuousScript).flatMap((part, index) => {
    if (index % 2 === 0) return fold(part).match(/[\p{L}\p{N}]+/gu) ?? [];
    const normalized = part.normalize("NFKC");
    if (typeof Intl.Segmenter !== "function") return cjkNgrams(normalized, indexing);
    segmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
    return Array.from(segmenter.segment(normalized), word => word.isWordLike ? word.segment : "").filter(Boolean);
  });
}
const vocabulary = new WeakMap<Passage, Set<string>>();
const questionWords = new Set(["how", "what", "do", "the", "and", "is", "of", "to", "lam", "nao", "cho", "toi", "cua", "co", "la", "gi", "de", "va"]);

export function findPassages(index: Index, query: string) {
  const words = [...new Set(wordsOf(query))].slice(0, 32);
  if (!words.length) return [];
  const meaningful = words.filter(term => !questionWords.has(term));
  const terms = meaningful.length ? meaningful : words;
  const frequency = new Map<string, number>();
  let total = 0;
  const matches: { path: string; passage: Passage; terms: string[]; fileTerms: number }[] = [];
  for (const doc of index.docs.values()) {
    const name = new Set(wordsOf(doc.path, true));
    const fileTerms = terms.filter(term => name.has(term)).length;
    for (const passage of doc.passages) {
      total++;
      let tokens = vocabulary.get(passage);
      if (!tokens) { tokens = new Set(wordsOf(passage.text, true)); vocabulary.set(passage, tokens); }
      const found = terms.filter(term => tokens.has(term));
      if (!found.length && !fileTerms) continue;
      for (const term of found) frequency.set(term, (frequency.get(term) ?? 0) + 1);
      matches.push({ path: doc.path, passage, terms: found, fileTerms });
    }
  }
  return matches.map(({ path, passage, terms: found, fileTerms }) => ({
    path, passage, score: found.reduce((sum, term) => sum + 1 + Math.log((total + 1) / (frequency.get(term)! + 1)), fileTerms * 0.3),
  })).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.passage.start - b.passage.start).slice(0, 15);
}
