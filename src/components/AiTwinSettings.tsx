import { AiTwinZaloOwnerStyle } from "./AiTwinZaloOwnerStyle";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AI_TWIN_NAME_MAX, AI_TWIN_PATH, AI_TWIN_STYLE_MAX, type AiTwinLearningExample, type AiTwinView } from "../../shared/ai-twin";
import { t } from "@/lib/i18n";
import { randomUuid } from "@/lib/random-uuid";
import { api, ApiError } from "@/state/api";
import { AiTwinControls } from "./AiTwinControls";
import { AiTwinLessons } from "./AiTwinLessons";
import { AiTwinPreview } from "./AiTwinPreview";
import { ConfirmDialog } from "./ConfirmDialog";
import { Card, SETTINGS_INPUT, SettingsField } from "./SettingsPrimitives";

export function AiTwinSettings() {
  const [view, setView] = useState<AiTwinView | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [example, setExample] = useState<AiTwinLearningExample | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"load" | "save" | "conflict" | null>(null);
  const requestKey = useRef<string | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const twin = view?.twin;
  const reviewableExample = example && twin && !twin.paused && view?.controls?.sourceIds.includes(example.thread) ? example : null;

  useEffect(() => { if (!reviewableExample) setExample(null); }, [reviewableExample]);

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    void api<AiTwinView>(AI_TWIN_PATH, { signal: abort.signal, timeoutMs: 8_000 })
      .then((result) => {
        if (abort.signal.aborted) return;
        setView(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) setError(reason instanceof ApiError && reason.status === 404 ? null : "load");
      })
      .finally(() => {
        if (!abort.signal.aborted) setRetrying(false);
      });
    return () => { alive.current = false; abort.abort(); };
  }, [loadAttempt]);

  useEffect(() => { if (editing) nameInput.current?.focus(); }, [editing]);

  async function reload() {
    try {
      const result = await api<AiTwinView>(AI_TWIN_PATH, { timeoutMs: 8_000 });
      if (alive.current) { setView(result); setError(null); }
    } catch {
      if (alive.current) setError("load");
    }
  }

  function begin() {
    setName(twin?.name ?? "");
    setStyle(twin?.style ?? "");
    requestKey.current = null;
    setError(null);
    setEditing(true);
  }

  async function write(method: string, body: object) {
    setPending(true);
    setError(null);
    try {
      const result = await api<AiTwinView>(AI_TWIN_PATH, { method, body: JSON.stringify(body), timeoutMs: 8_000 });
      if (!alive.current) return;
      setView(result);
      if (!result.twin) setExample(null);
      setEditing(false);
      setConfirming(false);
      requestKey.current = null;
    } catch (reason) {
      if (!alive.current) return;
      if (reason instanceof ApiError && reason.body?.error === "twin_changed") {
        setError("conflict");
        const fresh = await api<AiTwinView>(AI_TWIN_PATH, { timeoutMs: 8_000 }).catch(() => null);
        if (alive.current && fresh) {
          setView(fresh);
          setEditing(false);
          setConfirming(false);
        }
      } else {
        setError("save");
      }
    } finally {
      if (alive.current) setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || !name.trim() || pending) return;
    if (twin) {
      void write("PATCH", { id: twin.id, revision: twin.revision, name, style, paused: twin.paused });
    } else {
      requestKey.current ??= randomUuid();
      void write("POST", { name, creationEpoch: view.creationEpoch, creationId: requestKey.current, createConsent: true });
    }
  }

  if (!view && error !== "load") return null;
  const writeError = error === "conflict" ? t("settings.aiTwin.conflict") :
    error === "save" ? t("settings.aiTwin.saveError") : null;
  return (
    <Card title={t("settings.aiTwin.title")} subtitle={t("settings.aiTwin.subtitle")}>
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <SettingsField label={t("settings.aiTwin.name")}>
            <input ref={nameInput} dir="auto" className={SETTINGS_INPUT} name="twin-name" value={name} maxLength={AI_TWIN_NAME_MAX}
              onChange={(event) => { setName(event.target.value); requestKey.current = null; }} required disabled={pending} />
          </SettingsField>
          {twin && (
            <SettingsField label={t("settings.aiTwin.style")}>
              <textarea dir="auto" className={`${SETTINGS_INPUT} h-auto min-h-20 py-1.5`} rows={3} maxLength={AI_TWIN_STYLE_MAX}
                value={style} onChange={(event) => setStyle(event.target.value)} disabled={pending} />
            </SettingsField>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="ui-button ui-button-primary" disabled={!name.trim() || pending}>
              {t(twin ? "common.save" : "settings.aiTwin.create")}
            </button>
            <button type="button" className="ui-button" disabled={pending} onClick={() => { setEditing(false); setError(null); }}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : twin ? (
        <>
          <div className="min-w-0 text-[13px] text-ink" dir="auto">
            <span className="break-words font-medium">{twin.name}</span>
            <span className="ms-2 text-ink-secondary">{t(twin.paused ? "settings.aiTwin.paused" : "settings.aiTwin.private")}</span>
          </div>
          {twin.style && <p dir="auto" className="whitespace-pre-wrap break-words text-[13px] text-ink-secondary">{twin.style}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-button" disabled={pending} onClick={begin}>{t("settings.aiTwin.edit")}</button>
            <button type="button" className="ui-button" disabled={pending} onClick={() => void write("PATCH", {
              id: twin.id, revision: twin.revision, name: twin.name, style: twin.style, paused: !twin.paused,
            })}>{t(twin.paused ? "settings.aiTwin.resume" : "settings.aiTwin.pause")}</button>
            <button type="button" className="ui-button" disabled={pending} onClick={() => { setError(null); setConfirming(true); }}>
              {t("settings.aiTwin.delete")}
            </button>
          </div>
          <AiTwinLessons key={"lessons:" + twin.id} twin={twin} lessons={view?.lessons ?? []}
            changed={setView} refresh={() => void reload()} example={reviewableExample} />
          {view && <AiTwinControls key={"controls:" + twin.id} view={view} changed={setView}
            refresh={() => void reload()} reviewExample={(entry) => setExample({ ...entry })} />}
          {view?.canReviewOwnerStyle && <AiTwinZaloOwnerStyle twin={twin} refresh={() => void reload()} />}
          {!twin.paused && <AiTwinPreview key={"preview:" + twin.id + ":" + twin.revision + ":" + (view?.preview?.key ?? "")}
            twin={twin} provider={view?.preview} allowSemantic={view?.lessons?.some((lesson) => lesson.allowProvider) === true} refresh={() => void reload()} />}
          <ConfirmDialog open={confirming} title={t("settings.aiTwin.delete")} body={<>
            {t("settings.aiTwin.deleteBody")}
            {writeError && <span role="alert" className="mt-2 block text-danger">{writeError}</span>}
          </>}
            confirmLabel={t("settings.aiTwin.delete")} pending={pending} returnFocusRef={createButton}
            onCancel={() => { if (!pending) { setConfirming(false); setError(null); } }}
            onConfirm={() => void write("DELETE", { id: twin.id, revision: twin.revision })} />
        </>
      ) : view ? (
        <div><button ref={createButton} type="button" className="ui-button ui-button-primary" onClick={begin}>
          {t("settings.aiTwin.create")}
        </button></div>
      ) : null}
      {pending && <p role="status" className="text-[12px] text-ink-secondary">{t("settings.aiTwin.saving")}</p>}
      {error === "load" && (
        <div aria-busy={retrying} className="flex flex-col items-start gap-2">
          <p role="alert" className="text-[12px] text-danger">{t("settings.aiTwin.loadError")}</p>
          <button type="button" className="ui-button" disabled={retrying} onClick={() => {
            setRetrying(true);
            setLoadAttempt((attempt) => attempt + 1);
          }}>{t("common.tryAgain")}</button>
        </div>
      )}
      {writeError && !confirming && <p role="alert" className="text-[12px] text-danger">{writeError}</p>}
    </Card>
  );
}
