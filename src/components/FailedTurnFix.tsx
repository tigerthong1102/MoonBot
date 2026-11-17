import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/use-media-query";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { Message } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { settingFix } from "../../shared/setting-fixes";
import { ModelPicker } from "./ModelPicker";

export type FailedTurnAction = { label: string; onClick: () => void };

const line = (text: string) => <p data-failed-turn-fix="line" className="mt-1.5 text-[13px] text-ink-secondary">{text}</p>;

export function useFailedTurnFix(tool: NonNullable<Message["tool"]>, botId: string | undefined, threadId: string | undefined): { action?: FailedTurnAction | null; control?: ReactNode } {
  const dispatch = useStoreDispatch();
  const bot = useStoreSelector((state) => (botId ? state.bots.find((candidate) => candidate.id === botId) : undefined));
  const phone = useMediaQuery(PHONE_LAYOUT), admin = useOwnerOrAdmin() !== false, advanced = useAdvancedMode();
  const fix = settingFix(tool);
  if (fix === "spend-limit") {
    if (!admin) return { action: null, control: line(t("chat.error.askOwnerSpendLimit")) };
    if (!advanced) return { action: null, control: line(t("chat.error.raiseSpendLimitAdvanced")) };
    return { action: { label: t("chat.error.openSpending"), onClick: () => dispatch({ type: "toggleAppSettings", open: true, section: "usage" }) } };
  }
  if (fix === "model" && bot && threadId && !phone) {
    return { control: <div data-failed-turn-fix="model" className="mt-1.5"><ModelPicker bot={bot} threadId={threadId} contained size="sm" label={<span className="text-[13px] text-ink-secondary">{t("chat.error.switchModel")}</span>} /></div> };
  }
  return {};
}
