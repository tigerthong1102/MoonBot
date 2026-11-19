import { useState } from "react";
import type { SettingsCardData } from "../../shared/app-settings";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/api";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { ASK_PRIMARY_BUTTON, ASK_SECONDARY_BUTTON } from "./AskCard";

export function ClearMessagesCard({ botId, threadId, messageId, card }: {
  botId: string; threadId?: string; messageId: string; card: Extract<SettingsCardData, { id: "clear-messages" }>;
}) {
  const dispatch = useStoreDispatch();
  const [saving, setSaving] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const busy = useStoreSelector((state) => state.bots.find((bot) => bot.id === botId)?.tasks?.find((task) => task.threadId === threadId)?.busy);
  if (expired || card.cancelled || card.threadId !== threadId) {
    return <p>{card.cancelled ? t("chat.clearMessages.cancelled") : t("chat.clearMessages.expired")}</p>;
  }
  async function answer(decision: "confirm" | "cancel") {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ cleared: boolean }>(`/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(card.threadId)}/clear-messages`, {
        method: "POST", body: JSON.stringify({ decision, messageId }),
      });
      if (result.cleared) dispatch({ type: "notice", notice: { kind: "note", botName: null, text: t("chat.clearMessages.done") } });
    } catch (cause) {
      if (cause instanceof ApiError && cause.body?.code === "clear_expired") setExpired(true);
      else if (cause instanceof ApiError && cause.body?.code === "clear_queued") setError(t("chat.clearMessages.queued"));
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div data-settings-card="clear-messages" className="flex max-w-[600px] flex-col gap-2">
      <p>{t("chat.clearMessages.question")}</p>
      {busy && <p role="status">{t("chat.clearMessages.wait")}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || saving} className={ASK_SECONDARY_BUTTON} onClick={() => void answer("cancel")}>{t("common.cancel")}</button>
        <button type="button" disabled={busy || saving} className={ASK_PRIMARY_BUTTON} onClick={() => void answer("confirm")}>{t("chat.clearMessages.confirm")}</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
