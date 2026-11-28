import { useEffect, useRef, useState } from "react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { AI_TWIN_PATH, AI_TWIN_PREVIEW_PATH, type AiTwinView } from "../../../shared/ai-twin";
import type { ZaloSourceLine } from "../../../shared/zalo-intelligence";
import { brainOwner, evidenceReader, latestPages, pageHistory, type VerifiedPage } from "./brain";

export interface ZaloKnowledgeExcerpt extends ZaloSourceLine { text: string }

// The owner approves precisely the displayed quotation and excerpt for this provider.
export function ZaloKnowledgeDraft({ item, excerpt, viewSignal }: {
  item: VerifiedPage; excerpt: ZaloKnowledgeExcerpt; viewSignal: AbortSignal;
}) {
  const [view, setView] = useState<AiTwinView | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const { page, evidence } = item;
  const quote = evidence.quote.trim().slice(0, 1_000);
  const citation = evidence.label.trim().slice(0, 180);

  async function verify(signal: AbortSignal) {
    if (await brainOwner(signal, false) !== page.owner) throw new Error("owner_changed");
    const latest = latestPages(await pageHistory(page.owner)).find(entry => entry.id === page.id);
    if (latest?.version !== page.version || latest.approvedAt !== page.approvedAt) throw new Error("page_changed");
    signal.throwIfAborted();
    // Watched folders tag their sync events with the dialog signal so the view recognizes its own read.
    const fresh = await evidenceReader(page.owner, viewSignal)(page.source);
    if (!fresh || fresh.quote !== evidence.quote || fresh.label !== evidence.label || await brainOwner(signal, false) !== page.owner) {
      throw new Error("source_changed");
    }
    signal.throwIfAborted();
  }

  async function run() {
    if (current.current || !quote || !citation) return;
    const request = new AbortController();
    current.current = request;
    const signal = AbortSignal.any([request.signal, viewSignal]);
    setFailed(false);
    setBusy(true);
    setDraft("");
    try {
      await verify(signal);
      if (!view?.preview || !view.twin) {
        const result = await api<AiTwinView>(AI_TWIN_PATH, { signal });
        signal.throwIfAborted();
        if (!result.preview || !result.twin || result.twin.paused) throw new Error("unavailable");
        setView(result);
        return;
      }
      const answer = await api<{ draft: string }>(AI_TWIN_PREVIEW_PATH, {
        method: "POST", signal, timeoutMs: 65_000,
        body: JSON.stringify({ id: view.twin.id, revision: view.twin.revision, key: view.preview.key, useProvider: true,
          question: excerpt.text, zaloSource: { source: excerpt.source, line: excerpt.line }, zaloEvidence: { citation, quote } }),
      });
      await verify(signal);
      setDraft(answer.draft);
    } catch {
      if (!signal.aborted) { setFailed(true); setView(null); }
    } finally {
      current.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }

  return <section className="my-2 grid gap-2">
    {view?.preview && <><p>{t("zaloKnowledge.disclosure", { provider: view.preview.name, model: view.preview.model, source: excerpt.source, line: excerpt.line })}</p>
      <blockquote className="whitespace-pre-wrap break-words">{excerpt.text}</blockquote>
      <p className="font-medium">{citation}</p><blockquote className="whitespace-pre-wrap break-words">{quote}</blockquote>
    </>}
    <button className="ui-button justify-self-start" type="button" disabled={busy} onClick={() => void run()}>
      {t(view ? "zaloKnowledge.generate" : "zaloKnowledge.prepare")}
    </button>
    {busy && <p role="status">{t("settings.aiTwin.lookupPending")}</p>}
    {failed && <p role="alert">{t("zaloKnowledge.changed")}</p>}
    {draft && <div role="status"><strong>{t("settings.aiTwin.privateDraft")}</strong><p className="whitespace-pre-wrap break-words">{draft}</p></div>}
  </section>;
}
