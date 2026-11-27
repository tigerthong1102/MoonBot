import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { libraryOwner } from "./source-cache";
import { observeLibraryOwner } from "./source-sync";
import {
  approvePage,
  evidenceReader,
  newPage,
  pageKinds,
  searchPages,
  sharesSource,
  verifiedPages,
  type BrainEvidence,
  type BrainPage,
  type BrainSelection,
  type VerifiedPage,
} from "./brain";
import { Select } from "../Select";
import { SourceCitation } from "./SourceCitation";
import { useStore } from "@/state/store";
import { closeConversationDialog as close } from "../conversation-share/conversation-share";

const field = "my-1 block w-full rounded-lg border border-hairline bg-inset p-2 text-ink";

export default function BrainDialog({ threadId, selection }: { threadId: string; selection?: BrainSelection }) {
  const { state, dispatch } = useStore();
  const [pages, setPages] = useState<VerifiedPage[]>([]);
  const [draft, setDraft] = useState<VerifiedPage | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [epoch, refresh] = useState(0);
  const view = useRef<AbortController | null>(null);
  const account = useRef<string | null>(null);
  const proposed = useRef(false);
  const activeDraft = useRef(draft);
  activeDraft.current = draft;
  useEffect(() => {
    let alive = true,
      reading = false;
    function hide() {
      view.current?.abort();
      setReady(false);
      setPages([]);
    }
    async function read() {
      hide();
      if (document.hidden) return;
      const controller = new AbortController(),
        signal = controller.signal;
      view.current = controller;
      reading = true;
      try {
        const owner = await libraryOwner(undefined, true);
        if (!owner) throw new Error();
        if (account.current && account.current !== owner) {
          close();
          return;
        }
        account.current = owner;
        const visible = await verifiedPages(owner, signal);
        const pending = activeDraft.current;
        const source = pending?.page.source ?? (!proposed.current ? selection : undefined);
        const evidence = source ? await evidenceReader(owner, signal)(source) : null;
        if ((source && !evidence) || (await libraryOwner(undefined, true)) !== owner) throw new Error();
        signal.throwIfAborted();
        if (!alive) return;
        setPages(visible);
        setError(false);
        if (evidence && !pending) {
          proposed.current = true;
          setDraft({ page: newPage(owner, evidence), evidence });
        }
        setReady(true);
      } catch {
        if (alive && !signal.aborted) {
          setPages([]);
          setDraft(null);
          setError(true);
        }
      } finally {
        if (view.current === controller) reading = false;
      }
    }
    const sync = () => {
      if (!reading) void read();
    };
    const unavailable = () => {
      hide();
      setDraft(null);
      setError(true);
    };
    const stop = observeLibraryOwner(
      () => (account.current ? JSON.stringify([account.current, threadId]) : null),
      unavailable,
    );
    const timer = window.setInterval(sync, 60000);
    window.addEventListener("focus", sync);
    window.addEventListener("startupbot-document-sync", sync);
    document.addEventListener("visibilitychange", read);
    void read();
    return () => {
      alive = false;
      view.current?.abort();
      stop();
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("startupbot-document-sync", sync);
      document.removeEventListener("visibilitychange", read);
    };
  }, [threadId, selection, epoch]);

  async function approve() {
    const signal = view.current?.signal;
    if (!draft || !signal || saving || !ready) return;
    setSaving(true);
    try {
      await approvePage(draft.page, signal);
      signal.throwIfAborted();
      activeDraft.current = null;
      setDraft(null);
      refresh((count) => count + 1);
    } catch {
      if (!signal.aborted) {
        setDraft(null);
        setReady(false);
        setError(true);
      }
    } finally {
      setSaving(false);
    }
  }
  function edit(patch: Partial<Pick<BrainPage, "title" | "body" | "kind">>) {
    setDraft((current) => current && { ...current, page: { ...current.page, ...patch } });
  }
  async function exportPage(item: VerifiedPage) {
    const signal = view.current?.signal;
    if (!ready || !signal) return;
    try {
      if ((await libraryOwner(undefined, true)) !== item.page.owner) throw new Error();
      const source = await evidenceReader(item.page.owner, signal)(item.page.source);
      if (!source || (await libraryOwner(undefined, true)) !== item.page.owner) throw new Error();
      signal.throwIfAborted();
      const data = [
        "# " + item.page.title,
        item.page.body,
        "## " + t("brain.evidence"),
        source.label,
        source.quote,
        ...source.citations.flatMap((c) => [c.label, c.quote]),
        JSON.stringify(source.source),
        new Date(item.page.approvedAt).toISOString(),
      ].join("\n\n");
      const url = URL.createObjectURL(new Blob([data], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "brain-" + item.page.id + ".md";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (!signal.aborted) {
        setReady(false);
        setError(true);
      }
    }
  }
  function reference(evidence: BrainEvidence) {
    const src = evidence.source;
    return (
      <details className="my-2">
        <summary className="cursor-pointer text-accent-text">{evidence.label}</summary>
        <blockquote className="my-2 max-h-40 overflow-auto whitespace-pre-wrap break-words border-s-2 border-hairline ps-3">
          {evidence.quote}
        </blockquote>
        {src.kind === "document" ? (
          <SourceCitation {...src}>{t("brain.openSource")}</SourceCitation>
        ) : (
          <button
            className="ui-button ui-button-sm"
            onClick={() => {
              const bot = state.bots.find(
                (b) => b.threadId === src.threadId || b.tasks?.some((task) => task.threadId === src.threadId),
              );
              if (!bot) return;
              dispatch({ type: "select", id: bot.id });
              if (bot.threadId !== src.threadId)
                dispatch({ type: "switchTask", botId: bot.id, threadId: src.threadId });
              dispatch({ type: "focusMessage", threadId: src.threadId, messageId: src.messageId });
              close();
            }}
          >
            {t("brain.openSource")}
          </button>
        )}
        {evidence.citations.map((c, i) => (
          <p className="my-2 whitespace-pre-wrap break-words" key={i}>
            <strong>{c.label}</strong>
            <br />
            {c.quote}
          </p>
        ))}
      </details>
    );
  }
  const visible = searchPages(pages, query);
  return (
    <dialog
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onCancel={close}
      aria-label={t("brain.name")}
      className="m-auto max-h-[88vh] w-[min(42rem,96vw)] overflow-auto rounded-xl border border-hairline bg-card p-5 text-sm text-ink backdrop:bg-black/30"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("brain.name")}</h2>
        <button className="ui-button ui-button-sm" onClick={close}>
          {t("reconcile.close")}
        </button>
      </header>
      {error && (
        <p role="alert">
          {t("brain.unavailable")}{" "}
          <button className="ui-button ui-button-sm" onClick={() => refresh((n) => n + 1)}>
            {t("chat.retry")}
          </button>
        </p>
      )}
      {!ready && !error && <p role="status">{t("knowledge.reading")}</p>}
      {ready &&
        (draft ? (
          <section>
            <h3 className="my-2 font-semibold">{t("brain.review")}</h3>
            <label>
              {t("brain.kind")}{" "}
              <Select value={draft.page.kind} onChange={(e) => edit({ kind: e.target.value as BrainPage["kind"] })}>
                {pageKinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`brain.${k}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              {t("brain.title")}
              <input
                className={field}
                maxLength={180}
                value={draft.page.title}
                onChange={(e) => edit({ title: e.target.value })}
              />
            </label>
            {draft.page.version > 0 && (
              <blockquote className="my-2 whitespace-pre-wrap text-ink-secondary">
                {pages.find((p) => p.page.id === draft.page.id)?.page.body}
              </blockquote>
            )}
            <label>
              {t("brain.claim")}
              <textarea
                className={field}
                rows={4}
                maxLength={4000}
                value={draft.page.body}
                onChange={(e) => edit({ body: e.target.value })}
              />
            </label>
            <h4 className="font-medium">{t("brain.evidence")}</h4>
            <p className="line-clamp-3 whitespace-pre-wrap break-words">{draft.evidence.quote}</p>
            {reference(draft.evidence)}
            <button
              className="ui-button ui-button-primary"
              disabled={saving || !draft.page.title.trim() || !draft.page.body.trim()}
              onClick={() => void approve()}
            >
              {t("brain.approve")}
            </button>
            <button className="ui-button ms-2" disabled={saving} onClick={() => setDraft(null)}>
              {t("common.cancel")}
            </button>
          </section>
        ) : (
          <section>
            <label className="my-3 block">
              {t("brain.search")}
              <input className={field} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {!visible.length && <p>{t("brain.empty")}</p>}
            {visible.map((item) => (
              <article className="my-3 border-t border-hairline pt-3" key={item.page.id}>
                <h3 className="break-words font-semibold">{item.page.title}</h3>
                <p className="text-xs text-ink-secondary">
                  {t(`brain.${item.page.kind}`)} · v{item.page.version} ·{" "}
                  {new Date(item.page.approvedAt).toLocaleDateString()}
                </p>
                <p className="my-2 whitespace-pre-wrap break-words">{item.page.body}</p>
                {reference(item.evidence)}
                {pages.some((p) => p.page.id !== item.page.id && sharesSource(p.page.source, item.page.source)) && (
                  <details>
                    <summary>{t("brain.related")}</summary>
                    <ul>
                      {pages
                        .filter((p) => p.page.id !== item.page.id && sharesSource(p.page.source, item.page.source))
                        .map((p) => (
                          <li key={p.page.id}>
                            <button className="text-accent-text" onClick={() => setQuery(p.page.title)}>
                              {p.page.title}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
                <button className="ui-button ui-button-sm" onClick={() => setDraft(item)}>
                  {t("brain.review")}
                </button>
                <button className="ui-button ui-button-sm ms-2" onClick={() => void exportPage(item)}>
                  {t("brain.export")}
                </button>
              </article>
            ))}
          </section>
        ))}
    </dialog>
  );
}
