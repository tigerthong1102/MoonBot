import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { citationLocation } from "./citation";
import { sourceAnswerIssue, type SourceAnswerIssue } from "./source-answer-issue";
import { openConversationDialog } from "../conversation-share/conversation-share";
import { SourcePassage } from "./SourcePassage";
import { cloudFolders, currentLibrary, observeLibraryOwner, onSourceSync, readSource, readWatch, scanSource, setSource as saveSource, type FolderSource } from "./source-sync";
import { Select } from "../Select";
import { libraryKey, readLibrary } from "./source-cache";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { api } from "@/state/api";
import { randomUuid } from "@/lib/random-uuid";
import { PdfGaps } from "./PdfGaps";
import { findPassages, indexSources, scanFolder, type Directory, type Index, type SourceFile } from "./source-index";

const issueLabel = { pdfLocked: "knowledge.pdfLocked", pdfLimit: "knowledge.pdfLimit", pdfRead: "knowledge.errorFile", signedOut: "files.signedOut", offline: "files.offline", missing: "files.status.missing", folder: "files.status.problem" } as const;
const empty = (): Index => ({ docs: new Map(), changes: [] });
type UnsavedSelection = { scope: string } & ({ folder: FolderSource; index: Index; manual?: never } | { folder?: never; manual: Index });

async function reader(threadId: string, background = false): Promise<{ scope: string | null; issue: SourceAnswerIssue | null }> {
  try {
    const scope = await libraryKey(threadId, { reportOffline: true, background });
    return { scope, issue: scope ? null : "knowledge.answerAccess" };
  } catch (cause) {
    return { scope: null, issue: sourceAnswerIssue(cause) };
  }
}

type Access = { scope: string; id: number; controller: AbortController };
type Retry = { payload: string; sendId: string };
type Props = { bot: Bot; open: boolean; close(): void };
export default function SourceLibrary({ bot, open, close }: Props) {
  const unsaved = useRef<UnsavedSelection | null>(null);
  const lastReader = useRef<string | null>(null);
  const submission = useRef<Retry | null>(null);
  const [query, setQuery] = useState("");
  return open && <OpenLibrary key={bot.threadId} bot={bot} close={close} lastReader={lastReader} unsaved={unsaved} submission={submission} query={query} setQuery={setQuery} />;
}

function OpenLibrary({ bot, close, lastReader, unsaved, submission, query, setQuery }: Omit<Props, "open"> & {
  lastReader: RefObject<string | null>; unsaved: RefObject<UnsavedSelection | null>; submission: RefObject<Retry | null>; query: string; setQuery(value: string): void;
}) {
  const [index, setIndex] = useState<Index>(empty);
  const current = useRef(index);
  const owner = useRef<Access | null>(null);
  const sequence = useRef(0);
  const verification = useRef<Promise<void> | null>(null);
  const pickerRequest = useRef(0);

  const [starting, setStarting] = useState(true);
  const [cacheFailed, setCacheFailed] = useState(false);
  const [watching, setWatching] = useState<FolderSource | null>(null);
  const [cloud, setCloud] = useState<Awaited<ReturnType<typeof cloudFolders>> | null>(null);
  const [offersCloud, setOffersCloud] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SourceAnswerIssue | null>(null);
  const [source, setSource] = useState<{ path: string; start: number } | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const recheck = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const clearAccess = useCallback((issue: SourceAnswerIssue | null = "knowledge.answerAccess") => {
    current.current = empty(); setIndex(current.current); setWatching(null); setCloud(null); setSendError(issue);
    if (issue) setSource(null);
  }, []);
  const bind = useCallback((scope: string | null) => {
    if ((owner.current?.scope ?? null) === scope) return;
    owner.current?.controller.abort();
    owner.current = scope ? { scope, id: ++sequence.current, controller: new AbortController() } : null;
    inFlight.current = false; setBusy(false); setSending(false); setError(false); setCacheFailed(false);
  }, []);
  const forget = useCallback(() => {
    lastReader.current = null; unsaved.current = null; submission.current = null; setQuery(""); setSource(null);
  }, [lastReader, unsaved, submission, setQuery]);
  const suspend = useCallback((issue: SourceAnswerIssue | null, forgetReader: boolean) => {
    bind(null);
    if (forgetReader) forget();
    clearAccess(issue);
  }, [bind, forget, clearAccess]);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; owner.current?.controller.abort(); owner.current = null; };
  }, []);
  useEffect(() => {
    let opening = 0, active = true;
    let stopSync: (() => void) | undefined, stopAuth: (() => void) | undefined;
    void fetch("/.well-known/openmausbot/environment").then(r => r.json()).then(env => {
      if (active) setOffersCloud(env?.capabilities?.cloudHome === true);
    }).catch(() => {});
    async function verifyOpening(syncedScope?: string) {
      const visit = ++opening, live = () => active && visit === opening;
      stopSync?.(); stopAuth?.();
      setStarting(true); clearAccess(null);
      let revision = 0;
      function unavailable(issue: SourceAnswerIssue | null) {
        ++revision;
        stopSync?.(); stopSync = undefined;
        suspend(issue, issue === "knowledge.answerAccess");
        const previous = lastReader.current;
        if (previous && !unsaved.current) {
          stopSync = onSourceSync(previous, () => { if (live() && !verification.current) begin(previous); });
        }
      }
      // The open dialog still needs sign-out notifications when maintenance has suspended its document subscription.
      stopAuth = observeLibraryOwner(() => lastReader.current, maintenance => {
        if (live()) unavailable(maintenance ? sourceAnswerIssue(maintenance) : "knowledge.answerAccess");
      });
      try {
        const initial = revision;
        const session = await reader(bot.threadId, !!syncedScope);
        if (!live() || initial !== revision) return;
        const scope = session.scope;
        if (!scope) return unavailable(session.issue);
        if (syncedScope && scope !== syncedScope) return unavailable("knowledge.answerAccess");
        if (lastReader.current && lastReader.current !== scope) forget();
        lastReader.current = scope; bind(scope);
        const access = owner.current!;
        if (unsaved.current?.scope !== scope) unsaved.current = null;
        async function restore(verify: boolean, background = false) {
          if (!live() || access.controller.signal.aborted || inFlight.current) return;
          const request = ++revision, pending = unsaved.current;
          const read = { signal: access.controller.signal, background };
          const [saved, watch] = pending
            ? [pending.folder ? (verify ? await scanSource(pending.folder, pending.index, read) : pending.index) : pending.manual, pending.folder]
            : await Promise.all([verify ? currentLibrary(access.scope, read) : readLibrary(access.scope), readWatch(access.scope).then(w => w?.source)]);
          if (!live() || access.controller.signal.aborted || request !== revision) return;
          const confirmed = await reader(bot.threadId, background);
          if (!live() || access.controller.signal.aborted || request !== revision || inFlight.current || pending !== unsaved.current) return;
          if (scope !== confirmed.scope) return unavailable(confirmed.issue ?? "knowledge.answerAccess");
          if (pending?.folder && saved) pending.index = saved;
          current.current = saved ?? empty(); setIndex(current.current); setWatching(watch ?? null); setCacheFailed(!!pending);
        }
        stopSync = onSourceSync(scope, background => {
          void restore(false, background).catch(() => { if (live() && !access.controller.signal.aborted) setCacheFailed(true); });
        });
        await restore(!syncedScope, !!syncedScope);
      } catch { if (live() && owner.current) setCacheFailed(true); }
      finally { if (live()) setStarting(false); }
    }
    const begin = (syncedScope?: string) => {
      const task = verifyOpening(syncedScope);
      verification.current = task;
      void task.finally(() => { if (verification.current === task) verification.current = null; });
    };
    const check = () => { if (!document.hidden && !verification.current) begin(); };
    recheck.current = check;
    begin();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false; recheck.current = null; verification.current = null; stopSync?.(); stopAuth?.();
      window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check);
    };
  }, [bot.threadId, lastReader, unsaved, bind, forget, clearAccess, suspend]);
  async function ready(access: Access) {
    while (verification.current && !access.controller.signal.aborted) await verification.current;
    return alive.current && owner.current === access && !access.controller.signal.aborted;
  }
  async function stillOwns(access: Access) {
    if (!await ready(access)) return false;
    const confirmed = await reader(bot.threadId);
    if (!await ready(access)) return false;
    if (access.scope === confirmed.scope) return true;
    suspend(confirmed.issue ?? "knowledge.answerAccess", !confirmed.scope && confirmed.issue === "knowledge.answerAccess");
    return false;
  }
  async function refresh(access: Access, read: () => Promise<SourceFile[]>, newFolder: FolderSource | null) {
    if (!await ready(access) || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      if (!await stillOwns(access)) return;
      const files = await read();
      if (!await ready(access)) return;
      const next = await indexSources(files, current.current, access.controller.signal);
      if (!await stillOwns(access)) return;
      current.current = next; setIndex(next); setWatching(newFolder); setError(false);
      let pending: UnsavedSelection | null = null;
      try { await saveSource(access.scope, next, newFolder, access.controller.signal); }
      catch { pending = newFolder ? { scope: access.scope, folder: newFolder, index: next } : { scope: access.scope, manual: next }; }
      if (!await ready(access)) return;
      unsaved.current = pending; setCacheFailed(!!pending);
      if (current.current !== next) {
        if (newFolder) recheck.current?.();
        else { current.current = next; setIndex(next); }
      }
    } catch { if (await ready(access)) setError(true); }
    finally { if (owner.current === access) { inFlight.current = false; setBusy(false); } }
  }
  async function syncWatching() {
    const access = owner.current;
    if (!access || !watching || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      if (!await stillOwns(access)) return;
      const read = { signal: access.controller.signal };
      const next = cacheFailed ? await scanSource(watching, current.current, read) : await currentLibrary(access.scope, read);
      if (!await stillOwns(access)) return;
      current.current = next ?? empty(); setIndex(current.current); setError(false);
      if (unsaved.current?.folder === watching) unsaved.current.index = current.current;
    } catch {
      if (await ready(access)) { current.current = empty(); setIndex(current.current); setCacheFailed(true); setError(true); }
    } finally { if (owner.current === access) { inFlight.current = false; setBusy(false); } }
  }
  async function clear() {
    const access = owner.current;
    if (!access || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      if (!await stillOwns(access)) return;
      const next = empty();
      try {
        await saveSource(access.scope, next, null, access.controller.signal);
        if (!await ready(access)) return;
        unsaved.current = null; setCacheFailed(false);
      } catch (cause) {
        if (!await ready(access)) return;
        if (!unsaved.current) throw cause;
        unsaved.current = { scope: access.scope, manual: next }; setCacheFailed(true);
      }
      current.current = next; setIndex(next); setWatching(null); setSource(null); setError(false);
    } catch { if (await ready(access)) setCacheFailed(true); }
    finally { if (owner.current === access) { inFlight.current = false; setBusy(false); } }
  }
  async function pickFolder() {
    const access = owner.current;
    if (!access) return;
    const request = ++pickerRequest.current;
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<Directory> }).showDirectoryPicker;
    if (!picker) return directoryInput.current?.click();
    try {
      const selected = await picker.call(window);
      if (await ready(access) && request === pickerRequest.current)
        await refresh(access, () => scanFolder(selected, access.controller.signal), { kind: "directory", name: selected.name, handle: selected });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      if (await ready(access) && request === pickerRequest.current) directoryInput.current?.click();
    }
  }
  async function pickCloud() {
    const access = owner.current;
    if (!access) return;
    const request = ++pickerRequest.current;
    try {
      const list = await cloudFolders(access.controller.signal);
      if (!await ready(access) || request !== pickerRequest.current) return;
      setCloud(list.filter(f => !f.threadId || f.threadId === bot.threadId)); setError(false);
    } catch { if (await ready(access) && request === pickerRequest.current) setError(true); }
  }
  function chosen(access: Access | null, list: FileList | null) {
    if (!access || !list?.length) return;
    const files = Array.from(list, file => ({ path: file.webkitRelativePath || file.name, file }))
      .filter(({ path }) => !path.split("/").some(part => part.startsWith(".") || part === "node_modules"));
    void refresh(access, async () => files, null);
  }
  const search = useDeferredValue(query);
  const hits = useMemo(() => findPassages(index, search), [index, search]);
  const shown = source ? index.docs.get(source.path) : null;
  const location = (hit: typeof hits[number]) => citationLocation(hit.path, hit.passage);
  async function ask() {
    const access = owner.current;
    if (!access || sending || !hits.length || !query.trim()) return;
    setSending(true); setSendError(null);
    try {
      if (!await stillOwns(access)) return;
      const selection = unsaved.current, read = { signal: access.controller.signal };
      if (selection && selection.scope !== access.scope) return suspend("knowledge.answerAccess", true);
      const fresh = selection?.folder ? await scanSource(selection.folder, index, read) : selection?.manual ?? await currentLibrary(access.scope, read);
      if (!await stillOwns(access)) return;
      if (selection !== unsaved.current) { setSendError("knowledge.answerChanged"); return; }
      if (!fresh) { current.current = empty(); setIndex(current.current); setSendError("knowledge.answerChanged"); return; }
      if (selection?.folder) selection.index = fresh;
      const selected = findPassages(fresh, query).slice(0, 3);
      const displayed = hits.slice(0, 3);
      if (!selected.length || selected.length !== displayed.length || selected.some((hit, i) =>
        hit.path !== displayed[i]?.path || hit.passage.start !== displayed[i]?.passage.start || fresh.docs.get(hit.path)?.digest !== index.docs.get(hit.path)?.digest)) {
        current.current = fresh; setIndex(fresh);
        const issue = fresh.changes.at(-1)?.issue;
        setSendError(issue === "signedOut" ? "knowledge.answerAccess" : issue === "offline" ? "knowledge.answerNetwork" : "knowledge.answerChanged"); return;
      }
      const evidence = selected.map(({ path, passage }) => ({
        path, digest: fresh.docs.get(path)!.digest, start: passage.start, page: passage.page,
        paragraph: passage.paragraph, text: passage.text, coverage: fresh.docs.get(path)?.coverage,
      }));
      const payload = JSON.stringify({ threadId: bot.threadId, question: query.trim(), evidence });
      if (submission.current?.payload !== payload) submission.current = { payload, sendId: randomUuid() };
      const response = await api<{ ok?: boolean }>(`/api/bots/${encodeURIComponent(bot.id)}/knowledge-answers`, {
        method: "POST", body: JSON.stringify({ threadId: bot.threadId, question: query.trim(), evidence, sendId: submission.current.sendId }),
        timeoutMs: 75_000, signal: access.controller.signal,
      });
      if (!await ready(access)) return;
      if (response?.ok !== true) throw new Error();
      submission.current = null;
      close();
    } catch (cause) { if (await ready(access)) setSendError(sourceAnswerIssue(cause)); }
    finally { if (owner.current === access) setSending(false); }
  }
  const renderedOwner = owner.current;
  return <dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={close} aria-label={t("knowledge.title")}
    className="m-auto max-h-[88vh] w-[min(46rem,96vw)] overflow-y-auto rounded-xl border border-hairline/40 bg-card p-5 text-sm text-ink backdrop:bg-black/30">
    <header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{t("knowledge.title")}</h2>
      <button type="button" className="ui-button ui-button-sm" onClick={close}>{t("reconcile.close")}</button></header>
    <p className="mb-3 text-xs text-ink-secondary">{t("knowledge.formats")}</p>
    <div className="flex flex-wrap gap-2">
      <button className="ui-button ui-button-sm" disabled={busy || starting || !renderedOwner} onClick={() => { ++pickerRequest.current; filesInput.current?.click(); }}>{t("knowledge.files")}</button>
      <button className="ui-button ui-button-sm" disabled={busy || starting || !renderedOwner} onClick={() => void pickFolder()}>{t("knowledge.folder")}</button>
      {(index.docs.size > 0 || watching) && <button className="ui-button ui-button-sm" disabled={busy || starting || !renderedOwner} onClick={() => void clear()}>{t("knowledge.clear")}</button>}
      {offersCloud && <button className="ui-button ui-button-sm" disabled={busy || starting || !renderedOwner} onClick={() => void pickCloud()}>{t("knowledge.cloudFolders")}</button>}
      {cloud && cloud.length === 0 && <span role="status">{t("knowledge.noCloud")}</span>}
      {cloud && cloud.length > 0 && <Select aria-label={t("knowledge.cloudFolders")} value="" onChange={e => {
        const selected = cloud.find(f => f.id === e.target.value);
        if (!selected || !renderedOwner) return;
        ++pickerRequest.current;
        const remote = { kind: "cloud" as const, id: selected.id, name: selected.name };
        void refresh(renderedOwner, () => readSource(remote, current.current, { signal: renderedOwner.controller.signal }), remote);
      }}><option value="">{t("knowledge.cloudFolders")}</option>{cloud.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}
      {watching && <button className="ui-button ui-button-sm" disabled={busy || starting || !renderedOwner} onClick={() => void syncWatching()}>{t("knowledge.refresh")}</button>}
      <input key={"files-" + renderedOwner?.id} type="file" multiple accept=".txt,.md,.markdown,.csv,.tsv,.pdf" hidden ref={filesInput} onChange={e => { chosen(renderedOwner, e.target.files); e.target.value = ""; }} />
      <input key={"folder-" + renderedOwner?.id} type="file" multiple hidden ref={node => { directoryInput.current = node; node?.setAttribute("webkitdirectory", ""); }} onChange={e => { chosen(renderedOwner, e.target.files); e.target.value = ""; }} />
    </div>
    {cacheFailed && <p role="status">{t("knowledge.cacheFailed")}</p>}
    {error && <p role="alert" className="my-2 text-danger">{t("knowledge.error")}</p>}
    <p role="status" className="my-2 text-xs text-ink-secondary">{busy || starting ? t("knowledge.reading") : t("knowledge.indexed", { count: index.docs.size })} {watching && t("knowledge.watching")}</p>
    {[...index.docs.values()].filter(doc => doc.coverage?.missing.length).map(doc => <PdfGaps key={doc.path + doc.digest} doc={doc} />)}
    {index.changes.length > 0 && <details className="my-2"><summary>{t("knowledge.changes")}</summary><ul className="max-h-32 overflow-y-auto">{index.changes.slice().reverse().map((c, i) =>
      <li key={i}>{c.at && <time dateTime={new Date(c.at).toISOString()}>{new Date(c.at).toLocaleString()} · </time>}{c.path} · {t(c.issue ? issueLabel[c.issue] : c.state === "error" ? "knowledge.errorFile" : `knowledge.${c.state}`)}</li>)}</ul></details>}
    <label className="block font-medium">{t("knowledge.query")}<input type="search" maxLength={1000} disabled={starting || !renderedOwner} value={starting || !renderedOwner ? "" : query} onChange={e => { setQuery(e.target.value); setSource(null); setSendError(null); }}
      className="mt-1 block w-full rounded-lg border border-hairline bg-inset p-2" /></label>
    {!starting && renderedOwner && query.trim() && !hits.length && <p className="my-3 text-ink-secondary">{t("knowledge.noHits")}</p>}
    {hits.length > 0 && <><ol className="my-3 max-h-72 overflow-y-auto">{hits.map(hit => <li key={JSON.stringify([hit.path, hit.passage.start])} className="border-b border-hairline/40 py-2">
      <button className="break-all text-start font-medium text-accent-text hover:underline" onClick={() => setSource({ path: hit.path, start: hit.passage.start })}>{location(hit)}</button>
      <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs">{hit.passage.text}</p></li>)}</ol>
      <button type="button" className="ui-button ui-button-primary" disabled={busy || sending || search !== query} onClick={ask}>{t("knowledge.ask", { count: Math.min(3, hits.length) })}</button></>}
    {sendError && <p role="alert">{t(sendError)}</p>}
    {sendError && !starting && !renderedOwner && <button className="ui-button ui-button-sm" onClick={() => recheck.current?.()}>{t("chat.retry")}</button>}
    {shown && source && <><SourcePassage doc={shown} start={source.start} />
      <button type="button" className="ui-button ui-button-sm" disabled={busy || starting || cacheFailed || !renderedOwner} onClick={() => {
        const selection = { kind: "document" as const, threadId: bot.threadId, path: shown.path, digest: shown.digest, start: source.start };
        close(); openConversationDialog({ kind: "brain", botId: bot.id, threadId: bot.threadId, selection });
      }}>{t("brain.save")}</button></>}
  </dialog>;
}
