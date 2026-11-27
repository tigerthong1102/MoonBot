import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/i18n";
import { libraryKey } from "./source-cache";
import { indexSources, type SourceDocument } from "./source-index";
import { SourcePassage } from "./SourcePassage";

export function SourceCitation({ threadId, digest, start, path, signal, children }: { threadId: string; digest: string; start: number; path?: string; signal?: AbortSignal; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<SourceDocument | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    void libraryKey(threadId).then(key => key ? import("./source-sync").then(module => module.currentLibrary(key, { signal })) : undefined).then(index => {
      if (active) setDoc([...index?.docs.values() ?? []].find(d => d.digest === digest && (!path || d.path === path) && d.passages.some(p => p.start === start)) ?? null);
    }).catch(() => { if (active) setDoc(null); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, threadId, digest, start, path, signal]);
  async function pick(file: File) {
    setBusy(true);
    try {
      const index = await indexSources([{ path: file.name, file }], { docs: new Map(), changes: [] });
      const found = index.docs.get(file.name);
      setDoc(found?.digest === digest && found.passages.some(p => p.start === start) ? found : null);
    } finally { setBusy(false); }
  }
  return <><button type="button" className="text-accent-text underline" onClick={() => setOpen(true)}>{children}</button>
    {open && createPortal(<dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={() => setOpen(false)} aria-label={t("knowledge.title")}
      className="m-auto max-h-[80vh] w-[min(40rem,94vw)] overflow-auto rounded-xl bg-card p-4 text-ink backdrop:bg-black/30">
      <button type="button" className="ui-button ui-button-sm" onClick={() => setOpen(false)}>{t("reconcile.close")}</button>
      {busy ? <p role="status">{t("knowledge.reading")}</p> : doc ? <SourcePassage doc={doc} start={start} /> :
        <label className="my-3 block">{t("knowledge.reselect")}<input type="file" className="block" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (file) void pick(file).catch(() => setDoc(null)); }} /></label>}
    </dialog>, document.body)}</>;
}
