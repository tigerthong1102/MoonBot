import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { citationLocation } from "./citation";
import { SourcePassage } from "./SourcePassage";
import { cloudFolders, currentLibrary, onSourceSync, readSource, readWatch, scanSource, setSource as saveSource, type FolderSource } from "./source-sync";
import { Select } from "../Select";
import { libraryKey, readLibrary } from "./source-cache";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { api } from "@/state/api";
import { randomUuid } from "@/lib/random-uuid";
import { findPassages, indexSources, scanFolder, type Directory, type Index, type SourceFile } from "./source-index";

const issueLabel = { signedOut: "files.signedOut", offline: "files.offline", missing: "files.status.missing", folder: "files.status.problem" } as const;
const empty = (): Index => ({ docs: new Map(), changes: [] });
type UnsavedSelection = { scope: string } & ({ folder: FolderSource; manual?: never } | { folder?: never; manual: Index });

export default function SourceLibrary({ bot, open, close }: { bot: Bot; open: boolean; close(): void }) {
  const submission = useRef<{ payload: string; sendId: string } | null>(null);
  const [index, setIndex] = useState<Index>(empty);
  const current = useRef(index);
  const key = useRef<string | null>(null);
  // A selection that the browser could not persist supersedes the old cache in this panel only.
  const unsaved = useRef<UnsavedSelection | null>(null);
  const [starting, setStarting] = useState(true);
  const [cacheFailed, setCacheFailed] = useState(false);
  const [watching, setWatching] = useState<FolderSource | null>(null);
  const [cloud, setCloud] = useState<Awaited<ReturnType<typeof cloudFolders>> | null>(null);
  const [offersCloud, setOffersCloud] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<{ path: string; start: number } | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    let off: (() => void) | undefined;
    void fetch("/.well-known/openmausbot/environment").then(r => r.json()).then(env => {
      if (active) setOffersCloud(env?.capabilities?.cloudHome === true);
    }).catch(() => {});
    void libraryKey(bot.threadId).then(async scope => {
      if (!active) return;
      key.current = scope;
      if (!scope) return;
      async function reload(check = false) {
        const [saved, watch] = await Promise.all([check ? currentLibrary(scope!) : readLibrary(scope!), readWatch(scope!)]);
        if (!active || inFlight.current || unsaved.current) return;
        if (saved) { current.current = saved; setIndex(saved); }
        setWatching(watch?.source ?? null);
      }
      off = onSourceSync(scope, () => { void reload().catch(() => setCacheFailed(true)); });
      await reload(true);
    }).catch(() => { if (active) setCacheFailed(true); }).finally(() => { if (active) setStarting(false); });
    return () => { active = false; off?.(); };
  }, [bot.threadId]);
  async function refresh(read: () => Promise<SourceFile[]>, newFolder: FolderSource | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const scope = key.current;
      if (scope !== await libraryKey(bot.threadId) || !alive.current) return;
      const files = await read();
      const next = await indexSources(files, current.current);
      if (scope !== await libraryKey(bot.threadId) || !alive.current) return;
      setWatching(newFolder);
      current.current = next;
      setIndex(next); setError(false);
      if (scope) {
        try { await saveSource(scope, next, newFolder); unsaved.current = null; setCacheFailed(false); }
        catch { unsaved.current = newFolder ? { scope, folder: newFolder } : { scope, manual: next }; setCacheFailed(true); }
      }
    } catch { if (alive.current) setError(true); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function syncWatching() {
    if (!watching || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const next = key.current && !cacheFailed ? await currentLibrary(key.current) : await scanSource(watching, current.current);
      if (alive.current) { current.current = next ?? empty(); setIndex(current.current); setError(false); }
    } catch {
      if (alive.current) { current.current = empty(); setIndex(current.current); setCacheFailed(true); setError(true); }
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function clear() {
    setBusy(true);
    try {
      const next = empty(), scope = key.current;
      if (scope !== await libraryKey(bot.threadId) || !alive.current) return;
      if (scope) {
        try { await saveSource(scope, next, null); unsaved.current = null; setCacheFailed(false); }
        catch (cause) {
          if (!unsaved.current) throw cause;
          unsaved.current = { scope, manual: next }; setCacheFailed(true);
        }
      }
      current.current = next; setIndex(next); setWatching(null); setSource(null); setError(false);
    } catch { setCacheFailed(true); }
    finally { setBusy(false); }
  }
  async function pickFolder() {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<Directory> }).showDirectoryPicker;
    if (!picker) return directoryInput.current?.click();
    try {
      const selected = await picker.call(window);
      await refresh(() => scanFolder(selected), { kind: "directory", name: selected.name, handle: selected });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      directoryInput.current?.click();
    }
  }
  function chosen(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list, file => ({ path: file.webkitRelativePath || file.name, file }))
      .filter(({ path }) => !path.split("/").some(part => part.startsWith(".") || part === "node_modules"));
    void refresh(async () => files, null);
  }
  const search = useDeferredValue(query);
  const hits = useMemo(() => findPassages(index, search), [index, search]);
  const shown = source ? index.docs.get(source.path) : null;
  const location = (hit: typeof hits[number]) => citationLocation(hit.path, hit.passage);
  async function ask() {
    if (sending || !hits.length || !query.trim()) return;
    setSending(true); setSendFailed(false);
    try {
      const scope = await libraryKey(bot.threadId);
      if (!scope || scope !== key.current || !alive.current) throw new Error();
      const selection = unsaved.current;
      if (selection && selection.scope !== scope) throw new Error();
      // Manual files were explicitly picked. A live folder always has to prove access to its contents again.
      const fresh = selection?.folder ? await scanSource(selection.folder, index) : selection?.manual ?? await currentLibrary(scope);
      if (!fresh || scope !== await libraryKey(bot.threadId) || !alive.current || selection !== unsaved.current) throw new Error();
      const selected = findPassages(fresh, query).slice(0, 3);
      const displayed = hits.slice(0, 3);
      if (!selected.length || selected.length !== displayed.length || selected.some((hit, i) =>
        hit.path !== displayed[i]?.path || hit.passage.start !== displayed[i]?.passage.start || fresh.docs.get(hit.path)?.digest !== index.docs.get(hit.path)?.digest)) {
        current.current = fresh; setIndex(fresh); throw new Error();
      }
      const evidence = selected.map(({ path, passage }) => ({
        path, digest: fresh.docs.get(path)!.digest, start: passage.start, page: passage.page,
        paragraph: passage.paragraph, text: passage.text,
      }));
      const payload = JSON.stringify({ threadId: bot.threadId, question: query.trim(), evidence });
      if (submission.current?.payload !== payload) submission.current = { payload, sendId: randomUuid() };
      const response = await api<{ ok?: boolean }>(`/api/bots/${encodeURIComponent(bot.id)}/knowledge-answers`, {
        method: "POST", body: JSON.stringify({ threadId: bot.threadId, question: query.trim(), evidence, sendId: submission.current.sendId }),
        timeoutMs: 75_000,
      });
      if (response?.ok !== true) throw new Error();
      submission.current = null;
      if (alive.current) close();
    } catch { if (alive.current) setSendFailed(true); }
    finally { if (alive.current) setSending(false); }
  }
  if (!open) return null;
  return <dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={close} aria-label={t("knowledge.title")}
    className="m-auto max-h-[88vh] w-[min(46rem,96vw)] overflow-y-auto rounded-xl border border-hairline/40 bg-card p-5 text-sm text-ink backdrop:bg-black/30">
    <header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{t("knowledge.title")}</h2>
      <button type="button" className="ui-button ui-button-sm" onClick={close}>{t("reconcile.close")}</button></header>
    <p className="mb-3 text-xs text-ink-secondary">{t("knowledge.formats")}</p>
    <div className="flex flex-wrap gap-2">
      <button className="ui-button ui-button-sm" disabled={busy || starting} onClick={() => filesInput.current?.click()}>{t("knowledge.files")}</button>
      <button className="ui-button ui-button-sm" disabled={busy || starting} onClick={() => void pickFolder()}>{t("knowledge.folder")}</button>
      {(index.docs.size > 0 || watching) && <button className="ui-button ui-button-sm" disabled={busy || starting} onClick={() => void clear()}>{t("knowledge.clear")}</button>}
      {offersCloud && <button className="ui-button ui-button-sm" disabled={busy || starting} onClick={() => {
        void cloudFolders().then(list => { setCloud(list.filter(f => !f.threadId || f.threadId === bot.threadId)); setError(false); }).catch(() => setError(true));
      }}>{t("knowledge.cloudFolders")}</button>}
      {cloud && cloud.length === 0 && <span role="status">{t("knowledge.noCloud")}</span>}
      {cloud && cloud.length > 0 && <Select aria-label={t("knowledge.cloudFolders")} value="" onChange={e => {
        const selected = cloud.find(f => f.id === e.target.value);
        if (!selected) return;
        const remote = { kind: "cloud" as const, id: selected.id, name: selected.name };
        void refresh(() => readSource(remote, current.current), remote);
      }}><option value="">{t("knowledge.cloudFolders")}</option>{cloud.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}
      {watching && <button className="ui-button ui-button-sm" disabled={busy || starting} onClick={() => void syncWatching()}>{t("knowledge.refresh")}</button>}
      <input type="file" multiple accept=".txt,.md,.markdown,.csv,.tsv,.pdf" hidden ref={filesInput} onChange={e => { chosen(e.target.files); e.target.value = ""; }} />
      <input type="file" multiple hidden ref={node => { directoryInput.current = node; node?.setAttribute("webkitdirectory", ""); }} onChange={e => { chosen(e.target.files); e.target.value = ""; }} />
    </div>
    {cacheFailed && <p role="status">{t("knowledge.cacheFailed")}</p>}
    {error && <p role="alert" className="my-2 text-danger">{t("knowledge.error")}</p>}
    <p role="status" className="my-2 text-xs text-ink-secondary">{busy ? t("knowledge.reading") : t("knowledge.indexed", { count: index.docs.size })} {watching && t("knowledge.watching")}</p>
    {index.changes.length > 0 && <details className="my-2"><summary>{t("knowledge.changes")}</summary><ul className="max-h-32 overflow-y-auto">{index.changes.slice().reverse().map((c, i) =>
      <li key={i}>{c.at && <time dateTime={new Date(c.at).toISOString()}>{new Date(c.at).toLocaleString()} · </time>}{c.path} · {t(c.issue ? issueLabel[c.issue] : c.state === "error" ? "knowledge.errorFile" : `knowledge.${c.state}`)}</li>)}</ul></details>}
    <label className="block font-medium">{t("knowledge.query")}<input type="search" maxLength={1000} value={query} onChange={e => { setQuery(e.target.value); setSource(null); }}
      className="mt-1 block w-full rounded-lg border border-hairline bg-inset p-2" /></label>
    {query.trim() && !hits.length && <p className="my-3 text-ink-secondary">{t("knowledge.noHits")}</p>}
    {hits.length > 0 && <><ol className="my-3 max-h-72 overflow-y-auto">{hits.map(hit => <li key={JSON.stringify([hit.path, hit.passage.start])} className="border-b border-hairline/40 py-2">
      <button className="break-all text-start font-medium text-accent-text hover:underline" onClick={() => setSource({ path: hit.path, start: hit.passage.start })}>{location(hit)}</button>
      <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs">{hit.passage.text}</p></li>)}</ol>
      <button type="button" className="ui-button ui-button-primary" disabled={busy || sending || search !== query} onClick={ask}>{t("knowledge.ask", { count: Math.min(3, hits.length) })}</button></>}
    {sendFailed && <p role="alert">{t("knowledge.sendError")}</p>}
    {shown && source && <SourcePassage doc={shown} start={source.start} />}
  </dialog>;
}
