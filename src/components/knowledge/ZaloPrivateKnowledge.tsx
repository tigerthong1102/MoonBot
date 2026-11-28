import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import {
  ZALO_PRIVATE_KNOWLEDGE_MARKER,
  ZALO_PRIVATE_KNOWLEDGE_PATH,
  type ZaloKnowledgeItem,
} from "../../../shared/zalo-knowledge-bookmarks";

import { searchPages } from "./brain";

const localRequest = { mode: "same-origin", redirect: "error", cache: "no-store" } as const;

export function ZaloPrivateKnowledge({ query, open, setOpen }: { query: string; open: boolean; setOpen: (open: boolean) => void }) {
  const contentId = useId();
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<ZaloKnowledgeItem[]>([]);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const control = new AbortController();
    void api<{ enabled: boolean }>(ZALO_PRIVATE_KNOWLEDGE_PATH + "?capability=1", {
      ...localRequest,
      signal: control.signal,
    })
      .then((result) => {
        if (!control.signal.aborted) setEnabled(result.enabled);
      })
      .catch(() => {});
    return () => control.abort();
  }, []);
  useEffect(() => {
    if (!enabled || !open) return;
    const control = new AbortController();
    request.current = control;
    const reload = () => {
      request.current?.abort();
      setItems([]);
      setRefresh((value) => value + 1);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(false);
    setBusy(true);
    if (!document.hidden)
      void api<{ items: ZaloKnowledgeItem[] }>(ZALO_PRIVATE_KNOWLEDGE_PATH, { ...localRequest, signal: control.signal })
        .then(({ items: result }) => {
          if (control.signal.aborted) return;
          const now = Date.now();
          setItems(result.filter((item) => item.expires > now));
          const deadline = Math.min(now + 15_000, ...result.map((item) => item.expires));
          timer = setTimeout(reload, Math.max(20, deadline - now));
        })
        .catch(() => {
          if (!control.signal.aborted) setError(true);
        })
        .finally(() => {
          if (!control.signal.aborted) setBusy(false);
        });
    window.addEventListener("focus", reload);
    window.addEventListener("startupbot-zalo-scope-changed", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      control.abort();
      request.current?.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", reload);
      window.removeEventListener("startupbot-zalo-scope-changed", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [enabled, open, refresh]);
  async function choose(item: ZaloKnowledgeItem) {
    if (busy || !open || document.hidden || item.expires <= Date.now()) return;
    request.current?.abort();
    const control = new AbortController();
    request.current = control;
    setBusy(true);
    setChanged(false);
    try {
      await api(ZALO_PRIVATE_KNOWLEDGE_PATH, {
        ...localRequest,
        method: "POST",
        signal: control.signal,
        body: JSON.stringify({
          grantId: item.grantId,
          sourceId: item.sourceId,
          revision: item.revision,
          save: !item.saved,
          reviewed: true,
        }),
      });
    } catch {
      if (!control.signal.aborted) setChanged(true);
    } finally {
      if (!control.signal.aborted) {
        setItems([]);
        setRefresh((value) => value + 1);
      }
    }
  }
  if (!enabled) return null;
  const matches = searchPages(
    items.map((item) => ({
      item,
      page: { title: "", body: "" },
      evidence: { label: item.conversationId + " " + item.sourceId, quote: item.quote },
    })),
    query,
  );
  return (
    <section className="my-3 rounded-lg border border-hairline p-3">
      <button
        type="button"
        className="ui-button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          request.current?.abort();
          setItems([]);
          setChanged(false);
          setOpen(!open);
        }}
      >
        {t("zaloKnowledgeShelf.title")}
      </button>
      <div id={contentId} hidden={!open}>
        {open && <>
          <p className="my-2">{t("zaloKnowledgeShelf.scope")}</p>
          <p>
            {t("zaloKnowledgeShelf.marker")} <code>{ZALO_PRIVATE_KNOWLEDGE_MARKER}</code>
          </p>
          {busy && <p role="status">{t("knowledge.reading")}</p>}
          {changed && <p role="alert">{t("zaloKnowledgeShelf.changed")}</p>}
          {error && (
            <button type="button" className="ui-button" onClick={() => setRefresh((value) => value + 1)}>
              {t("chat.retry")}
            </button>
          )}
          {!error && !busy && matches.length === 0 && <p role="status">{t("zaloKnowledgeShelf.empty")}</p>}
          <ul>
            {matches.map(({ item }) => (
              <li key={item.grantId + ":" + item.sourceId} className="my-2 border-t border-hairline pt-2">
                <strong>{t(item.saved ? "zaloKnowledgeShelf.saved" : "zaloKnowledgeShelf.candidate")}</strong>
                <p>
                  {t("zaloKnowledgeShelf.source", {
                    chat: item.conversationId,
                    sender: item.senderId,
                    id: item.sourceId,
                    at: new Date(item.timestamp).toLocaleString(),
                    until: new Date(item.expires).toLocaleString(),
                  })}
                </p>
                <blockquote className="whitespace-pre-wrap break-words">{item.quote}</blockquote>
                <button type="button" disabled={busy} className="ui-button" onClick={() => void choose(item)}>
                  {t(item.saved ? "zaloKnowledgeShelf.remove" : "zaloKnowledgeShelf.save")}
                </button>
              </li>
            ))}
          </ul>
        </>}
      </div>
    </section>
  );
}
