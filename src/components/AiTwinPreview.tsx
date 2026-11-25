import { useEffect, useRef, useState, type FormEvent } from "react";
import { AI_TWIN_PREVIEW_PATH, AI_TWIN_QUESTION_MAX, type AiTwinPreviewProvider, type AiTwinProfile } from "../../shared/ai-twin";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/api";
import { AiTwinDisclosure } from "./AiTwinDisclosure";
import { SETTINGS_INPUT, SettingsField } from "./SettingsPrimitives";

export function AiTwinPreview({ twin, provider, refresh }: {
  twin: AiTwinProfile;
  provider: AiTwinPreviewProvider | undefined;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<"retry" | "changed" | null>(null);
  const [pending, setPending] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider || !question.trim() || abort.current) return;
    const request = new AbortController();
    abort.current = request;
    setPending(true);
    setDraft("");
    setError(null);
    try {
      const answer = await api<{ draft: string }>(AI_TWIN_PREVIEW_PATH, {
        method: "POST", timeoutMs: 24_000, signal: request.signal,
        body: JSON.stringify({ id: twin.id, revision: twin.revision, key: provider.key, question, useProvider: true }),
      });
      if (!request.signal.aborted) setDraft(answer.draft);
    } catch (problem) {
      if (!request.signal.aborted) {
        setError(problem instanceof ApiError && (problem.body?.error === "twin_preview_changed" || problem.body?.error === "twin_changed") ? "changed" : "retry");
      }
    } finally {
      abort.current = null;
      if (!request.signal.aborted) setPending(false);
    }
  }

  return (
    <AiTwinDisclosure title={t("settings.aiTwin.preview")} open={open} onToggle={() => {
      setOpen(!open);
      if (open) {
        abort.current?.abort();
        setPending(false);
        setQuestion("");
        setDraft("");
        setError(null);
      }
    }}>
      {open && provider ? (
        <form onSubmit={generate} className="mt-3 flex flex-col gap-2">
          <SettingsField label={t("settings.aiTwin.sampleQuestion")} hint={t("settings.aiTwin.previewDisclosure", { provider: provider.name, model: provider.model })}>
            <textarea dir="auto" className={`${SETTINGS_INPUT} h-auto min-h-20 py-1.5`} rows={3} maxLength={AI_TWIN_QUESTION_MAX}
              value={question} onChange={(event) => { setQuestion(event.target.value); setDraft(""); }} disabled={pending} required />
          </SettingsField>
          <div>
            <button type="submit" className="ui-button ui-button-primary" disabled={pending || !question.trim() || error === "changed"}>
              {t(pending ? "settings.aiTwin.generating" : "settings.aiTwin.generateDraft")}
            </button>
          </div>
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
      ) : open && <p className="mt-2 text-[13px] text-ink-secondary">{t("settings.aiTwin.noPreviewProvider")}</p>}
    </AiTwinDisclosure>
  );
}
