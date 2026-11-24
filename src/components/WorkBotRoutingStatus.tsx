import type { Dispatch } from "react";
import type { Action, Message } from "@/state/store";
import { t } from "@/lib/i18n";

export function WorkBotRoutingStatus({ message, botId, threadId, dispatch }: { message: Message; botId: string; threadId: string; dispatch: Dispatch<Action> }) {
  const route = message.workBotRouting;
  if (!route || route.state === "dispatched") return null;
  return <div role="status" className="mt-1 text-[11px] text-ink-tertiary">
    {t(`workBotRouting.${route.state}`)}
    {(route.state === "classifying" || route.state === "waiting_choice" || route.state === "dispatching") && <button type="button" className="ml-2 underline" onClick={() => dispatch({ type: "interrupt", botId, threadId })}>{t("chat.stop")}</button>}
  </div>;
}
