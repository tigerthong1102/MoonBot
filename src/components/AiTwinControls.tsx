import { useEffect, useId, useState } from "react";
import {
  AI_TWIN_DELEGATION_PATH, AI_TWIN_LEARNING_PATH, AI_TWIN_PHONE_PATH, type AiTwinLearningExample, type AiTwinLearningView, type AiTwinView,
} from "../../shared/ai-twin";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/api";
import { Select } from "./Select";
import { SettingsField, SettingsFoldRow } from "./SettingsPrimitives";

export function AiTwinControls({ view, changed, refresh, reviewExample }: {
  view: AiTwinView;
  changed: (view: AiTwinView) => void;
  refresh: () => void;
  reviewExample: (example: AiTwinLearningExample) => void;
}) {
  const panelId = useId();
  const { twin, controls, lessons, canEnablePhone } = view;
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<AiTwinLearningView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [room, setRoom] = useState("");
  const [lesson, setLesson] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void api<AiTwinLearningView>(AI_TWIN_LEARNING_PATH, { signal: abort.signal, timeoutMs: 8_000 })
      .then((result) => { if (!abort.signal.aborted) setScopes(result); })
      .catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [open, twin?.revision, attempt]);

  if (!twin || !controls) return null;
  const roomLabels = new Map((scopes?.rooms ?? []).map((entry) => [entry.id, entry.label]));
  const sourceLabels = new Map((scopes?.conversations ?? []).map((entry) => [entry.id, entry.label]));
  const manual = lessons?.filter(entry => entry.origin === "manual");
  const lessonLabels = new Map((lessons ?? []).map((entry) => [entry.id, entry.question]));

  async function patch(path: string, body: object) {
    if (!twin || pending) return;
    setPending(true);
    setError(false);
    try {
      changed(await api<AiTwinView>(path, {
        method: "PATCH", timeoutMs: 8_000, body: JSON.stringify({ id: twin.id, revision: twin.revision, ...body }),
      }));
      setScopes(null);
    } catch (problem) {
      setError(true);
      if (problem instanceof ApiError && problem.status === 409) refresh();
    } finally {
      setPending(false);
    }
  }

  const readySource = sourceLabels.has(source) && !controls.sourceIds.includes(source);
  const readyRoom = roomLabels.has(room) && lessonLabels.has(lesson)
    && !controls.delegations.some((grant) => grant.room === room && grant.lesson === lesson);
  const grantedLesson = manual?.find((entry) => entry.id === lesson);

  return <SettingsFoldRow id="ai-twin-controls" panelId={panelId} title={t("settings.aiTwin.controls")}
    open={open} onToggle={() => { setOpen(!open); setScopes(null); setError(false); }}>
    {open && <div className="mt-3 flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">{t("settings.aiTwin.learning")}</h3>
        <p className="text-[12px] text-ink-secondary">{t("settings.aiTwin.learningDisclosure")}</p>
        <SettingsField label={t("settings.aiTwin.conversation")}>
          <Select value={source} onChange={(event) => setSource(event.target.value)} disabled={!scopes || pending}>
            <option value="">{t("settings.aiTwin.chooseConversation")}</option>
            {scopes?.conversations.filter(({ id }) => !controls.sourceIds.includes(id)).map((entry) =>
              <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </Select>
        </SettingsField>
        <div><button type="button" className="ui-button" disabled={!readySource || pending}
          onClick={() => { void patch(AI_TWIN_LEARNING_PATH, { thread: source, enabled: true }); setSource(""); }}>
          {t("settings.aiTwin.allowLearning")}
        </button></div>
        {controls.sourceIds.map((id) => <div key={id} className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>{sourceLabels.get(id) ?? t("settings.aiTwin.unavailableSource")}</span>
          <button type="button" className="ui-button" disabled={pending}
            onClick={() => void patch(AI_TWIN_LEARNING_PATH, { thread: id, enabled: false })}>{t("settings.aiTwin.removeSource")}</button>
        </div>)}
        {scopes?.style && <p className="text-[12px] text-ink-secondary">{t("settings.aiTwin.observedStyle", {
          samples: scopes.style.samples, words: scopes.style.typicalWords,
        })}</p>}
        {scopes?.examples.map((example) => <div key={example.thread + ":" + example.message} className="text-[13px]">
          <div className="text-ink-secondary">{sourceLabels.get(example.thread)}</div>
          {example.question && <p dir="auto" className="break-words font-medium text-ink">{example.question}</p>}
          <p dir="auto" className="whitespace-pre-wrap break-words">{example.text}</p>
          <button type="button" className="ui-button" disabled={pending}
            onClick={() => reviewExample(example)}>{t("settings.aiTwin.reviewExample")}</button>
        </div>)}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">{t("settings.aiTwin.delegation")}</h3>
        <p className="text-[12px] text-ink-secondary">{t("settings.aiTwin.delegationDisclosure")}</p>
        <SettingsField label={t("settings.aiTwin.room")}>
          <Select value={room} onChange={(event) => setRoom(event.target.value)} disabled={!scopes || pending}>
            <option value="">{t("settings.aiTwin.chooseRoom")}</option>
            {scopes?.rooms.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </Select>
        </SettingsField>
        <SettingsField label={t("settings.aiTwin.lessonQuestion")}>
          <Select value={lesson} onChange={(event) => setLesson(event.target.value)} disabled={pending}>
            <option value="">{t("settings.aiTwin.chooseLesson")}</option>
            {manual?.map((entry) => <option key={entry.id} value={entry.id}>{entry.question}</option>)}
          </Select>
        </SettingsField>
        {grantedLesson && <p dir="auto" className="whitespace-pre-wrap break-words text-[13px]">{grantedLesson.answer}</p>}
        <div><button type="button" className="ui-button" disabled={!readyRoom || pending}
          onClick={() => void patch(AI_TWIN_DELEGATION_PATH, { room, lesson, enabled: true })}>{t("settings.aiTwin.allowRoom")}</button></div>
        {controls.delegations.map((grant) => <div key={grant.room + ":" + grant.lesson} className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>{roomLabels.get(grant.room) ?? t("settings.aiTwin.unavailableSource")} · {lessonLabels.get(grant.lesson)}</span>
          <button type="button" className="ui-button" disabled={pending}
            onClick={() => void patch(AI_TWIN_DELEGATION_PATH, { ...grant, enabled: false })}>{t("settings.aiTwin.removeGrant")}</button>
        </div>)}
      </section>
      {canEnablePhone && <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">{t("settings.aiTwin.phone")}</h3>
        <p className="text-[12px] text-ink-secondary">{t("settings.aiTwin.phoneDisclosure")}</p>
        <div><button type="button" className="ui-button" disabled={pending}
          onClick={() => void patch(AI_TWIN_PHONE_PATH, { enabled: !controls.phone })}>
          {t(controls.phone ? "settings.aiTwin.disablePhone" : "settings.aiTwin.enablePhone")}
        </button></div>
      </section>}
      {error && <p role="alert" className="text-[12px] text-danger">{t("settings.aiTwin.saveError")}{" "}
        <button type="button" className="underline" onClick={() => { setError(false); setAttempt((value) => value + 1); }}>
          {t("common.tryAgain")}
        </button>
      </p>}
    </div>}
  </SettingsFoldRow>;
}
