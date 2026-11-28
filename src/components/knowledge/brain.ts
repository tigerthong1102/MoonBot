import { browserRecord } from "@/lib/browser-records";
import { sha256Hex } from "@/lib/sha256";
import { randomUuid } from "@/lib/random-uuid";
import { t } from "@/lib/i18n";
import { api, apiFetch } from "@/state/api";
import type { Message } from "@/state/store";
import { libraryOwner, parseSourceLink } from "./source-cache";
import { currentLibrary } from "./source-sync";
import { citationLocation } from "./citation";
import type { Index } from "./source-index";

export const pageKinds = ["customer", "project", "decision", "procedure", "document"] as const;
export type PageKind = (typeof pageKinds)[number];
export type BrainSource =
  | { kind: "document"; threadId: string; path: string; digest: string; start: number }
  | { kind: "message"; threadId: string; messageId: string; digest: string };
export type BrainSelection = BrainSource | { kind: "message"; threadId: string; messageId: string; digest?: undefined };
export interface BrainPage {
  id: string;
  version: number;
  owner: string;
  approvedAt: number;
  title: string;
  body: string;
  kind: PageKind;
  source: BrainSource;
}
export interface BrainEvidence {
  source: BrainSource;
  label: string;
  quote: string;
  citations: { label: string; quote: string }[];
}
export type VerifiedPage = { page: BrainPage; evidence: BrainEvidence };
export const newPage = (owner: string, evidence: BrainEvidence): BrainPage => ({
  id: randomUuid(),
  owner,
  version: 0,
  approvedAt: 0,
  kind: "decision",
  source: evidence.source,
  title: evidence.quote.split(/\r?\n/)[0]?.slice(0, 90) || evidence.label,
  body: evidence.quote.slice(0, 4000),
});

export async function pageHistory(owner: string) {
  return browserRecord<BrainPage[]>("readonly", (store) =>
    store.getAll(IDBKeyRange.bound(["brain", owner], ["brain", owner, []])),
  );
}

export function latestPages(history: BrainPage[]) {
  const latest = new Map<string, BrainPage>();
  for (const page of history) if ((latest.get(page.id)?.version ?? -1) < page.version) latest.set(page.id, page);
  return [...latest.values()].sort((a, b) => b.approvedAt - a.approvedAt);
}

type Library = Awaited<ReturnType<typeof currentLibrary>>;
function passage(index: Library, ref: { path?: string; digest: string; start: number }) {
  const matches = ref.path
    ? [index?.docs.get(ref.path)]
    : [...(index?.docs.values() ?? [])].filter((doc) => doc.digest === ref.digest);
  const doc = matches.length === 1 ? matches[0] : undefined;
  if (doc?.digest !== ref.digest) return null;
  const part = doc.passages.find((p) => p.start === ref.start);
  return part ? { label: citationLocation(doc.path, part), quote: part.text } : null;
}

export function brainOwner(signal: AbortSignal, background: boolean) {
  return libraryOwner((input, init) => apiFetch(input,{ ...init,signal,background,timeoutMs:30000 }),true);
}

// The cache lives for one read or approval only. A later action checks the viewer and source again.
export function evidenceReader(owner: string, signal: AbortSignal, background = false) {
  const messages = new Map<string, Promise<{ messages: Message[] }>>();
  const rights = new Map<string, Promise<unknown>>();
  const libraries = new Map<string, Promise<Index | undefined>>();
  async function documents(threadId: string) {
    if (!libraries.has(threadId))
      libraries.set(threadId, currentLibrary(JSON.stringify([owner, threadId]), { signal, background }));
    return libraries.get(threadId);
  }
  return async (selection: BrainSelection): Promise<BrainEvidence | null> => {
    signal.throwIfAborted();
    const { threadId } = selection;
    if (selection.kind === "document") {
      if (!rights.has(threadId))
        rights.set(threadId, api("/api/threads/" + encodeURIComponent(threadId) + "/messages?limit=0", { signal, background }));
      await rights.get(threadId);
      const found = passage(await documents(threadId), selection);
      return found && { ...found, source: selection, citations: [] };
    }
    const path = "/api/threads/" + encodeURIComponent(threadId) + "/messages?limit=1&around=" + encodeURIComponent(selection.messageId);
    if (!messages.has(path)) messages.set(path, api<{ messages: Message[] }>(path, { signal, background }));
    const row = (await messages.get(path))?.messages.find(m => m.id === selection.messageId);
    if (row?.kind !== "text" || !row.text?.trim() || row.workBotReviewHold || row.workBotCopy || row.workBotRouting)
      return null;
    const digest = await sha256Hex(new TextEncoder().encode(row.text));
    if (selection.digest && digest !== selection.digest) return null;
    const links = [...row.text.matchAll(/\]\((#startupbot-source-[^\s)]+)\)/g)];
    const citations = [];
    if (row.text.includes("#startupbot-source-") && !links.length) return null;
    if (links.length) {
      const index = await documents(threadId);
      for (const link of links) {
        const ref = parseSourceLink(link[1]!);
        const found = ref && passage(index, ref);
        if (!found) return null;
        citations.push(found);
      }
    }
    signal.throwIfAborted();
    const label =
      t(row.role === "bot" ? "brain.botSource" : "brain.chatSource") + " · " + new Date(row.at).toLocaleString();
    return { source: { ...selection, digest }, label, quote: row.text.slice(0, 8000), citations };
  };
}

export async function verifiedPages(owner: string, signal: AbortSignal, background = false) {
  const read = evidenceReader(owner, signal, background);
  const pages = latestPages(await pageHistory(owner));
  const visible: VerifiedPage[] = [];
  for (const page of pages) {
    signal.throwIfAborted();
    const evidence = await read(page.source).catch(() => null);
    if (evidence) visible.push({ page, evidence });
  }
  if ((await brainOwner(signal, background)) !== owner) throw new Error("viewer_changed");
  signal.throwIfAborted();
  return visible;
}

export async function approvePage(draft: BrainPage, signal: AbortSignal) {
  if (!draft.title.trim() || !draft.body.trim() || draft.title.length > 180 || draft.body.length > 4000)
    throw new Error("invalid_draft");
  const owner = await libraryOwner(undefined, true);
  if (
    !owner ||
    owner !== draft.owner ||
    !(await evidenceReader(owner, signal)(draft.source)) ||
    (await libraryOwner(undefined, true)) !== owner
  )
    throw new Error("source_unavailable");
  const page = {
    ...draft,
    title: draft.title.trim(),
    body: draft.body.trim(),
    version: draft.version + 1,
    approvedAt: Date.now(),
  };
  await browserRecord("readwrite", (store) => {
    signal.throwIfAborted();
    return store.add(page, ["brain", owner, page.id, page.version]);
  });
  return page;
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().replaceAll("đ", "d");
const questionWords = new Set([
  "khach",
  "hang",
  "ngay",
  "nao",
  "da",
  "la",
  "gi",
  "cua",
  "co",
  "cho",
  "toi",
  "when",
  "what",
  "the",
  "is",
  "a",
  "of",
  "did",
]);
type SearchablePage = { page: Pick<BrainPage, "title" | "body">; evidence: Pick<BrainEvidence, "label" | "quote"> };
export function searchPages<T extends SearchablePage>(pages: T[], question: string) {
  const query = fold(question.trim());
  if (!query) return pages;
  const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const specific = words.filter((w) => !questionWords.has(w));
  const terms = specific.length ? specific : words;
  return pages
    .map((item) => {
      const title = fold(item.page.title),
        body = fold(item.page.body);
      const source = fold(item.evidence.label + " " + item.evidence.quote);
      const score = terms.reduce(
        (n, w) => n + (title.includes(w) ? 4 : 0) + (body.includes(w) ? 2 : 0) + (source.includes(w) ? 1 : 0),
        0,
      );
      return { item, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item);
}

export function sharesSource(a: BrainSource, b: BrainSource) {
  if (a.threadId !== b.threadId) return false;
  if (a.kind === "message") return b.kind === "message" && a.messageId === b.messageId && a.digest === b.digest;
  return b.kind === "document" && a.path === b.path && a.digest === b.digest;
}
