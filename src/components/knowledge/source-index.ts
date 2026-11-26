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

export async function scanFolder(root: Directory): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  let entries = 0;
  async function scan(dir: Directory, prefix: string, depth: number) {
    if (depth > 20) throw new Error("folder limit");
    for await (const child of dir.values()) {
      if (++entries > 10_000) throw new Error("folder limit");
      if (child.name.startsWith(".") || child.name === "node_modules") continue;
      const path = prefix + child.name;
      if (child.kind === "directory") await scan(child, path + "/", depth + 1);
      else if (accepts.test(child.name)) {
        if (files.length >= MAX_FILES) throw new Error("folder limit");
        try { files.push({ path, file: await child.getFile() }); } catch { files.push({ path }); }
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
      // Split long paragraphs for bounded retrieval while keeping their true source offset.
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

export async function indexSources(files: SourceFile[], previous: Index): Promise<Index> {
  const supported = files.filter(entry => accepts.test(entry.path));
  if (supported.length > MAX_FILES || supported.reduce((total, e) => total + (e.file?.size ?? 0), 0) > MAX_LIBRARY)
    throw new Error("library limit");
  const docs = new Map<string, SourceDocument>();
  const changes: SourceChange[] = [];
  const paths = new Set<string>();
  let textSize = 0, passageCount = 0;
  for (const { path, file } of supported) {
    if (paths.has(path)) throw new Error("duplicate file");
    paths.add(path);
    try {
      if (!file) throw new Error("file unavailable");
      const pdf = /\.pdf$/i.test(path);
      if (file.size > (pdf ? 12 * 1024 * 1024 : MAX_FILE)) throw new Error("file limit");
      const bytes = await file.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
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
    } catch { changes.push({ path, state: "error" }); }
  }
  for (const path of previous.docs.keys()) if (!paths.has(path)) changes.push({ path, state: "removed" });
  return { docs, changes };
}

const fold = (value: string) => value.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
const wordsOf = (value: string) => fold(value).match(/[\p{L}\p{N}]+/gu) ?? [];
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
    const name = new Set(wordsOf(doc.path));
    const fileTerms = terms.filter(term => name.has(term)).length;
    for (const passage of doc.passages) {
      total++;
      let tokens = vocabulary.get(passage);
      if (!tokens) { tokens = new Set(wordsOf(passage.text)); vocabulary.set(passage, tokens); }
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
