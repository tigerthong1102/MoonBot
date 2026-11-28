import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/i18n";
import { libraryKey } from "./source-cache";
import { indexSources, type SourceDocument } from "./source-index";
import { sourceAnswerIssue, type SourceAnswerIssue } from "./source-answer-issue";
import { SourcePassage } from "./SourcePassage";

export function SourceCitation({ threadId, digest, start, path, signal, children }: { threadId: string; digest: string; start: number; path?: string; signal?: AbortSignal; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<SourceDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<SourceAnswerIssue | null>(null);
  const [resume, setResume] = useState(0);
  const generation = useRef(0);
  const watchedScope = useRef<string | null>(null);
  const watching = useRef(false);
  useEffect(() => {
    if (!open) return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        generation.current++;
        setDoc(null);
        setBusy(false);
        setIssue("knowledge.answerAccess");
      } else setResume(value => value + 1);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [open]);
  useEffect(() => {
    if (!open || document.hidden) return;
    let active = true;
    let invalidated = false;
    const visit = ++generation.current;
    watchedScope.current = null;
    watching.current = false;
    let stop: (() => void) | undefined;
    setDoc(null);
    setBusy(true);
    setIssue(null);
    void import("./source-sync").then(async module => {
      if (!active) return;
      stop = module.observeLibraryOwner(() => watchedScope.current, (cause) => {
        if (!active) return;
        invalidated = true;
        generation.current++;
        setBusy(false); setDoc(null); setIssue(cause ? sourceAnswerIssue(cause) : "knowledge.answerAccess");
      });
      watching.current = true;
      const key = await libraryKey(threadId, { signal, reportOffline: true });
      if (!active || generation.current !== visit) return;
      watchedScope.current = key;
      if (!key) { if (active) setIssue("knowledge.answerAccess"); return; }
      const index = await module.currentLibrary(key, { signal });
      if (!active || generation.current !== visit) return;
      if (await libraryKey(threadId, { signal, reportOffline: true }) !== key) {
        if (active && generation.current === visit) setIssue("knowledge.answerAccess");
        return;
      }
      return index;
    }).then(index => {
      if (active && !invalidated && generation.current === visit) setDoc([...index?.docs.values() ?? []].find(d => d.digest === digest && (!path || d.path === path) && d.passages.some(p => p.start === start)) ?? null);
    }).catch((cause: unknown) => { if (active && generation.current === visit) { setDoc(null); setIssue(sourceAnswerIssue(cause)); } }).finally(() => { if (active && generation.current === visit) setBusy(false); });
    return () => { active = false; generation.current++; watching.current = false; watchedScope.current = null; stop?.(); };
  }, [open, threadId, digest, start, path, signal, resume]);
  async function pick(file: File) {
    if (document.hidden) return;
    const visit = generation.current;
    setBusy(true);
    try {
      const key = await libraryKey(threadId, { signal });
      if (!key || !watching.current || generation.current !== visit) return;
      const index = await indexSources([{ path: file.name, file }], { docs: new Map(), changes: [] });
      if (generation.current !== visit) return;
      const found = index.docs.get(file.name);
      const allowed = await libraryKey(threadId, { signal }) === key;
      if (!document.hidden && generation.current === visit) {
        const verified = allowed && found?.digest === digest && found.passages.some(p => p.start === start) ? found : null;
        if (verified && watching.current) watchedScope.current = key;
        else if (verified) return;
        setDoc(verified);
        if (verified) setIssue(null);
      }
    } catch {
      if (generation.current === visit) setDoc(null);
    } finally { if (generation.current === visit) setBusy(false); }
  }
  const close = () => { generation.current++; setDoc(null); setIssue(null); setOpen(false); };
  return <><button type="button" className="text-accent-text underline" onClick={() => { setDoc(null); setIssue(null); setOpen(true); }}>{children}</button>
    {open && createPortal(<dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={close} aria-label={t("knowledge.title")}
      className="m-auto max-h-[80vh] w-[min(40rem,94vw)] overflow-auto rounded-xl bg-card p-4 text-ink backdrop:bg-black/30">
      <button type="button" className="ui-button ui-button-sm" onClick={close}>{t("reconcile.close")}</button>
      {issue && <p role="alert" className="text-[12px] text-danger">{t(issue)}</p>}
      {busy ? <p role="status">{t("knowledge.reading")}</p> : doc ? <SourcePassage doc={doc} start={start} /> :
        <label className="my-3 block">{t("knowledge.reselect")}<input type="file" className="block" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (file) void pick(file); }} /></label>}
    </dialog>, document.body)}</>;
}
