import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  AI_TWIN_LESSONS_PATH, AI_TWIN_LESSON_ANSWER_MAX, AI_TWIN_LESSON_QUESTION_MAX,
  type AiTwinLearningExample, type AiTwinLesson, type AiTwinProfile, type AiTwinView,
} from "../../shared/ai-twin";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/api";
import { SETTINGS_INPUT, SettingsField, SettingsFoldRow } from "./SettingsPrimitives";

type LessonForm = {
  lessonId?: string;
  question: string;
  answer: string;
  allowProvider: boolean;
  example?: Pick<AiTwinLearningExample, "thread" | "message">;
};

export function AiTwinLessons({ twin, lessons, changed, refresh, example }: {
  twin: AiTwinProfile;
  lessons: readonly AiTwinLesson[];
  changed: (view: AiTwinView) => void;
  refresh: () => void;
  example?: AiTwinLearningExample | null;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LessonForm | null>(null);
  const [error, setError] = useState<"retry" | "changed" | "duplicate" | "full" | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const questionInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!example) {
      setForm((current) => current?.example ? null : current);
      return;
    }
    if (active.current) return;
    setOpen(true);
    setError(null);
    setForm({
      question: example.question ?? "",
      answer: example.text,
      allowProvider: false,
      example: { thread: example.thread, message: example.message },
    });
  }, [example]);

  const reviewingExample = Boolean(form?.example);
  useEffect(() => { if (reviewingExample) questionInput.current?.focus(); }, [reviewingExample]);

  async function write(method: "POST" | "DELETE", data: object) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api<AiTwinView>(AI_TWIN_LESSONS_PATH, {
        method, body: JSON.stringify({ id: twin.id, revision: twin.revision, ...data }), timeoutMs: 8_000,
      });
      setForm(null);
      changed(result);
    } catch (problem) {
      const code = problem instanceof ApiError ? problem.body?.error : undefined;
      if (code === "twin_changed") {
        setError("changed");
        setForm(null);
        refresh();
      } else if (code === "twin_lesson_duplicate") {
        setError("duplicate");
      } else {
        setError(code === "twin_lessons_full" ? "full" : "retry");
      }
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form?.question.trim() && form.answer.trim()) void write("POST", { ...form, saveAsLesson: true });
  }

  return (
    <SettingsFoldRow id="ai-twin-lessons" panelId={panelId} title={t("settings.aiTwin.lessons")} open={open} onToggle={() => setOpen(!open)}>
      <div className="mt-3 flex flex-col gap-3">
        {lessons.length > 0 && (
          <ul className="flex flex-col gap-3">
            {lessons.map((lesson) => (
              <li key={lesson.id} className="flex flex-col gap-1.5 text-[13px]">
                <div dir="auto" className="break-words font-medium text-ink">{lesson.question}</div>
                <div dir="auto" className="whitespace-pre-wrap break-words text-ink-secondary">{lesson.answer}</div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="ui-button" disabled={pending}
                    onClick={() => { setError(null); setForm({ lessonId: lesson.id, question: lesson.question, answer: lesson.answer, allowProvider: lesson.allowProvider === true }); }}>
                    {t("settings.aiTwin.editLesson")}
                  </button>
                  <button type="button" className="ui-button" disabled={pending}
                    onClick={() => void write("DELETE", { lessonId: lesson.id })}>
                    {t("settings.aiTwin.forgetLesson")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {form ? (
          <form onSubmit={save} className="flex flex-col gap-3">
            <SettingsField label={t("settings.aiTwin.lessonQuestion")}>
              <input ref={questionInput} className={SETTINGS_INPUT} dir="auto" value={form.question} maxLength={AI_TWIN_LESSON_QUESTION_MAX} required disabled={pending}
                onChange={(event) => setForm({ ...form, question: event.target.value })} />
            </SettingsField>
            <SettingsField label={t("settings.aiTwin.lessonAnswer")}>
              <textarea className={`${SETTINGS_INPUT} h-auto min-h-20 py-1.5`} dir="auto" value={form.answer} rows={3}
                maxLength={AI_TWIN_LESSON_ANSWER_MAX} required disabled={pending}
                onChange={(event) => setForm({ ...form, answer: event.target.value })} />
            </SettingsField>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" checked={form.allowProvider} disabled={pending}
                onChange={(event) => setForm({ ...form, allowProvider: event.target.checked })} />
              {t("settings.aiTwin.allowProviderLesson")}
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="ui-button ui-button-primary" disabled={pending || !form.question.trim() || !form.answer.trim()}>
                {t("settings.aiTwin.saveLesson")}
              </button>
              <button type="button" className="ui-button" disabled={pending} onClick={() => { setForm(null); setError(null); }}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <button type="button" className="ui-button" disabled={pending}
              onClick={() => { setError(null); setForm({ question: "", answer: "", allowProvider: false }); }}>
              {t("settings.aiTwin.addLesson")}
            </button>
          </div>
        )}
        {pending && <p role="status" className="text-[12px] text-ink-secondary">{t("settings.aiTwin.saving")}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{t(
          error === "duplicate" ? "settings.aiTwin.lessonDuplicate" :
            error === "full" ? "settings.aiTwin.lessonFull" :
              error === "changed" ? "settings.aiTwin.conflict" : "settings.aiTwin.saveError",
        )}</p>}
      </div>
    </SettingsFoldRow>
  );
}
