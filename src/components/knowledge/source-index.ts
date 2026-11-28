import type { PdfCoverage } from "../../../shared/source-evidence";
import { sha256Hex } from "../../lib/sha256";

export const accepts = /\.(txt|md|markdown|csv|tsv|pdf)$/i;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_LIBRARY = 16 * 1024 * 1024;
const MAX_FILES = 300;
export type SourceFile = { path: string; file: File } | { path: string; file?: undefined };
export interface Passage { page: number; paragraph: number; readonly text: string; start: number }
export interface SourceDocument { path: string; digest: string; file: File; passages: readonly Passage[]; coverage?: PdfCoverage }
export type SourceChange = { path: string; state: "added" | "changed" | "removed" | "error"; at?: number; issue?: "missing" | "signedOut" | "offline" | "folder" | "pdfLocked" | "pdfLimit" | "pdfRead" };
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

function pdfIssue(error: unknown) {
  if (error instanceof Error && error.name === "PasswordException") return "pdfLocked";
  if (error instanceof Error && ["file limit", "page limit", "text limit", "passage limit", "index limit"].includes(error.message)) return "pdfLimit";
  return "pdfRead";
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
    const pdf = /\.pdf$/i.test(path);
    try {
      if (!file) throw new Error("file unavailable");
      if (file.size > (pdf ? 12 * 1024 * 1024 : MAX_FILE)) throw new Error("file limit");
      const bytes = await file.arrayBuffer();
      signal?.throwIfAborted();
      const digest = await sha256Hex(bytes);
      signal?.throwIfAborted();
      const saved = previous.docs.get(path);
      let doc = saved;
      if (!doc || doc.digest !== digest || (pdf && !doc.coverage)) {
        const extracted = pdf ? await (await import("./pdf-text")).pdfText(bytes) : undefined;
        const text = extracted?.text ?? new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0")) throw new Error("binary file");
        doc = { path, digest, file, passages: splitPassages(text), ...(extracted && { coverage: extracted.coverage }) };
      }
      const size = doc.passages.reduce((total, p) => total + p.text.length, 0);
      if (textSize + size > 12 * 1024 * 1024 || passageCount + doc.passages.length > 40_000) throw new Error("index limit");
      textSize += size; passageCount += doc.passages.length;
      docs.set(path, doc);
      if (doc !== saved) changes.push({ path, state: saved ? "changed" : "added" });
    } catch (error) {
      signal?.throwIfAborted();
      const issue = pdf && file ? pdfIssue(error) : undefined;
      changes.push({ path, state: "error", ...(issue && { issue }) });
    }
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
type Posting = number | number[];
const documentTerms = new WeakMap<readonly Passage[], Map<string, Posting>>();

function passageNumbers(passages: readonly Passage[]) {
  const cached = documentTerms.get(passages);
  if (cached) return cached;
  const postings = new Map<string, Posting>();
  for (const [i, passage] of passages.entries()) {
    for (const term of wordsOf(passage.text, true)) {
      const numbers = postings.get(term);
      if (numbers === undefined) postings.set(term, i);
      else if (typeof numbers === "number") {
        if (numbers !== i) postings.set(term, [numbers, i]);
      } else if (numbers.at(-1) !== i) numbers.push(i);
    }
  }
  documentTerms.set(passages, postings);
  return postings;
}

type Hit = { path: string; passage: Passage; score: number };
const MAX_HITS = 15;

function keepHit(hits: Hit[], path: string, passage: Passage, score: number) {
  const compare = (other: Hit) => other.score - score || path.localeCompare(other.path) || passage.start - other.passage.start;
  if (hits.length === MAX_HITS && compare(hits[MAX_HITS - 1]!) >= 0) return;
  const position = hits.findIndex(other => compare(other) < 0);
  hits.splice(position < 0 ? hits.length : position, 0, { path, passage, score });
  if (hits.length > MAX_HITS) hits.pop();
}

const questionWords = new Set(["how", "what", "do", "the", "and", "is", "of", "to", "lam", "nao", "cho", "toi", "cua", "co", "la", "gi", "de", "va"]);

export function findPassages(index: Index, query: string) {
  const words = [...new Set(wordsOf(query))].slice(0, 32);
  if (!words.length) return [];
  const meaningful = words.filter(term => !questionWords.has(term));
  const terms = meaningful.length ? meaningful : words;
  const frequency = terms.map(() => 0);
  let total = 0;
  const documents = [];
  for (const doc of index.docs.values()) {
    total += doc.passages.length;
    const name = new Set(wordsOf(doc.path, true));
    const fileScore = terms.filter(term => name.has(term)).length * 0.3;
    const postings = passageNumbers(doc.passages);
    const matches = terms.map((term, i) => {
      const posting = postings.get(term);
      const numbers = typeof posting === "number" ? [posting] : posting;
      frequency[i]! += numbers?.length ?? 0;
      return numbers;
    });
    if (fileScore || matches.some(Boolean)) documents.push({ doc, fileScore, matches });
  }
  const weights = frequency.map(count => Math.log((total + 1) / (count + 1)));
  const hits: Hit[] = [];
  for (const { doc, fileScore, matches } of documents) {
    const scores = new Float64Array(doc.passages.length).fill(fileScore);
    for (const [i, numbers] of matches.entries()) {
      if (!numbers) continue;
      for (const n of numbers) scores[n] = scores[n]! + 1 + weights[i]!;
    }
    for (let n = 0; n < scores.length; n++) {
      if (scores[n]) keepHit(hits, doc.path, doc.passages[n]!, scores[n]!);
    }
  }
  return hits;
}
