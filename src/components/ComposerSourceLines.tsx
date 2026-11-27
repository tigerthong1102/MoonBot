import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { pasteAttachment, type PasteAttachment } from "@/lib/composer-attachments";
import { fetchSourceLines, type SourceLineReference } from "@/lib/source-line-reference";
import { collectMessageFiles } from "./AttachmentGallery";
import { Select } from "./Select";
import type { Message } from "@/state/store";

function sourceEntries(messages: readonly Message[]) {
  const files = messages.filter(m => m.kind === "text" && m.role === "bot").slice(-100).flatMap(message => {
    const attached = (message.attachments ?? []).flatMap(f => f.kind === "file" ? [{ path: f.path, name: f.name }] : []);
    const linked = collectMessageFiles((message.text ?? "").slice(0, 32_768), attached.map(f => f.path));
    const files = [...attached, ...linked];
    return files.filter(f => /\.(?:txt|md|csv|tsv|json|ya?ml|xml|log|js|ts|py|sql)$/i.test(f.name))
      .slice(0, 24).map(file => ({ ...file, messageId: message.id, id: JSON.stringify([message.id, file.path]) }));
  });
  return Array.from(new Map(files.map(file => [file.id, file])).values());
}

export function ComposerSourceLines({ messages, threadId, attach }: { messages: Message[]; threadId: string; attach(file: PasteAttachment): void }) {
  const [choice, setChoice] = useState(""), [start, setStart] = useState("1"), [end, setEnd] = useState("1");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const entries = useMemo(() => sourceEntries(messages), [messages]);
  if (!entries.length) return null;
  const selected = entries.find(e => e.id === choice) ?? entries[0];
  const add = async () => {
    setBusy(true); setError("");
    try {
      const ref = { threadId, messageId: selected.messageId, path: selected.path, name: selected.name, start: Number(start), end: Number(end) };
      const { sha256 } = await fetchSourceLines(ref, threadId);
      if (live.current) attach({ ...pasteAttachment(`${ref.name} · L${ref.start}–${ref.end} · ${sha256.slice(0, 12)}`), resource: { ...ref, sha256 } });
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (live.current) setBusy(false); }
  };
  return <details className="text-xs text-ink-secondary"><summary className="cursor-pointer">{t("composer.sourceLines")}</summary>
    <fieldset disabled={busy} className="flex flex-wrap items-center gap-2 py-2">
      <Select size="sm" aria-label={t("composer.sourceLines")} value={selected.id} onChange={e => setChoice(e.target.value)}>
        {entries.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </Select>
      <label>{t("composer.sourceFrom")} <input className="w-16" type="number" min="1" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>{t("composer.sourceTo")} <input className="w-16" type="number" min={start} value={end} onChange={e => setEnd(e.target.value)} /></label>
      <button type="button" className="ui-button ui-button-sm" onClick={() => void add()}>{t("composer.attach")}</button>
    </fieldset>{error && <p role="alert">{error}</p>}
  </details>;
}

export function SourceLineChip({ source, threadId }: { source: SourceLineReference; threadId: string }) {
  const [body, setBody] = useState("");
  const serial = useRef(0);
  return <details onToggle={async e => {
    const id = ++serial.current;
    setBody("");
    if (!e.currentTarget.open) return;
    try { const reply = await fetchSourceLines(source, threadId); if (id === serial.current) setBody(reply.text); }
    catch (error) { if (id === serial.current) setBody(error instanceof Error ? error.message : String(error)); }
  }}><summary>{source.name} · L{source.start}–{source.end} · {source.sha256.slice(0, 12)}</summary>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{body}</pre></details>;
}
