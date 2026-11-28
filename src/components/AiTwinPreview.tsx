import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AI_TWIN_LOOKUP_PATH, AI_TWIN_PREVIEW_PATH, AI_TWIN_QUESTION_MAX, type AiTwinLesson, type AiTwinPreviewProvider, type AiTwinProfile } from "../../shared/ai-twin";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/api";
import { SETTINGS_INPUT, SettingsField, SettingsFoldRow } from "./SettingsPrimitives";

export function AiTwinPreview({ twin, provider, allowSemantic, refresh }: {
  twin: AiTwinProfile;
  provider: AiTwinPreviewProvider | undefined;
  allowSemantic: boolean;
  refresh: () => void;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [match, setMatch] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [lesson, setLesson] = useState<AiTwinLesson | null | undefined>(undefined);
  const [error, setError] = useState<"retry" | "changed" | null>(null);
  const [pending, setPending] = useState<"lookup" | "semantic" | "generate" | "grounded" | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function run(action: "lookup" | "semantic" | "generate" | "grounded") {
    if (!question.trim() || abort.current || (action !== "lookup" && !provider)) return;
    const generate = action === "generate" || action === "grounded";
    const request = new AbortController();
    abort.current = request;
    setPending(action);
    setDraft("");
    setLesson(undefined);
    setMatch(undefined);
    setError(null);
    try {
      const base = { id: twin.id, revision: twin.revision, question };
      if (generate && provider) {
        const answer = await api<{ draft: string; lesson?: AiTwinLesson; match?: string }>(AI_TWIN_PREVIEW_PATH, {
          method: "POST", timeoutMs: 65_000, signal: request.signal,
          body: JSON.stringify({ ...base, key: provider.key, useProvider: true, ...(action === "grounded" ? { useMemory: true } : {}) }),
        });
        if (!request.signal.aborted) {
          setDraft(answer.draft);
          setLesson(answer.lesson);
          setMatch(answer.match);
        }
      } else {
        const answer = await api<{ lesson: AiTwinLesson | null; match?: string }>(AI_TWIN_LOOKUP_PATH, {
          method: "POST", timeoutMs: action === "semantic" ? 45_000 : 8_000, signal: request.signal,
          body: JSON.stringify(action === "semantic" && provider ? { ...base, key: provider.key, useProvider: true } : base),
        });
        if (!request.signal.aborted) {
          setLesson(answer.lesson);
          setMatch(answer.match);
        }
      }
    } catch (problem) {
      if (!request.signal.aborted) {
        setError(problem instanceof ApiError && (problem.body?.error === "twin_preview_changed" || problem.body?.error === "twin_changed") ? "changed" : "retry");
      }
    } finally {
      abort.current = null;
      if (!request.signal.aborted) setPending(null);
    }
  }

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("lookup");
  }

  return (
    <SettingsFoldRow id="ai-twin-preview" panelId={panelId} title={t("settings.aiTwin.preview")} open={open} onToggle={() => {
      setOpen(!open);
      if (open) {
        abort.current?.abort();
        setPending(null);
        setQuestion("");
        setDraft("");
        setLesson(undefined);
        setError(null);
      }
    }}>
      {open && (
        <form onSubmit={lookup} className="mt-3 flex flex-col gap-2">
          <SettingsField label={t("settings.aiTwin.sampleQuestion")}>
            <textarea dir="auto" className={`${SETTINGS_INPUT} h-auto min-h-20 py-1.5`} rows={3} maxLength={AI_TWIN_QUESTION_MAX}
              value={question} onChange={(event) => { setQuestion(event.target.value); setDraft(""); setLesson(undefined); }} disabled={pending !== null} required />
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="ui-button ui-button-primary" disabled={pending !== null || !question.trim() || error === "changed"}>
              {t("settings.aiTwin.lookupLesson")}
            </button>
            {provider && <button type="button" className="ui-button" disabled={pending !== null || !question.trim() || error === "changed"}
              onClick={() => void run("generate")}>{t("settings.aiTwin.generateDraft")}</button>}
            {provider && <button type="button" className="ui-button" disabled={!allowSemantic || pending !== null || !question.trim() || error === "changed"}
              onClick={() => void run("semantic")}>{t("settings.aiTwin.semanticLookup")}</button>}
            {provider && <button type="button" className="ui-button" disabled={pending !== null || !question.trim() || error === "changed"}
              onClick={() => void run("grounded")}>{t("settings.aiTwin.groundedDraft")}</button>}
          </div>
          {provider && <p className="text-[12px] text-ink-secondary">{t("settings.aiTwin.memoryDisclosure", { provider: provider.name, model: provider.model })}</p>}
          {provider && !allowSemantic && <p className="text-[12px] text-ink-secondary">{t("settings.aiTwin.semanticNeedsLessons")}</p>}
          {pending && <p role="status" className="text-[12px] text-ink-secondary">{t(pending === "lookup" || pending === "semantic" ? "settings.aiTwin.lookupPending" : "settings.aiTwin.generating")}</p>}
          {lesson === null && <p role="status" className="text-[13px] text-ink-secondary">{t("settings.aiTwin.lessonMissing")}</p>}
          {lesson && (
            <div role="status" className="flex flex-col gap-1 text-[13px]">
              <span className="font-medium text-ink">{t(match === "semantic" ? "settings.aiTwin.semanticSource" : "settings.aiTwin.lessonSource")}</span>
              <p dir="auto" className="break-words text-ink-secondary">{lesson.question}</p>
              <p dir="auto" className="whitespace-pre-wrap break-words text-ink-secondary">{lesson.answer}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[12px] text-danger">
              {t(error === "changed" ? "settings.aiTwin.previewChanged" : "settings.aiTwin.previewError")}{" "}
              {error === "changed" && <button type="button" className="underline" onClick={() => { setError(null); refresh(); }}>{t("settings.profile.retry")}</button>}
            </p>
          )}
          {draft && (
            <div role="status" className="flex flex-col gap-1 text-[13px]">
              <span className="font-medium text-ink">{t("settings.aiTwin.privateDraft")}</span>
              <p dir="auto" className="whitespace-pre-wrap break-words text-ink-secondary">{draft}</p>
            </div>
          )}
        </form>
      )}
    </SettingsFoldRow>
  );
}
