import type { AppTriggerService } from "@/lib/app-triggers";
import { t } from "@/lib/i18n";

export function AppCursorWarning({ issue }: { issue: AppTriggerService["cursorReview"] }) {
  if (!issue) return null;
  const message = issue === "unverified" ? t("automations.cursorReview.unverified")
    : issue === "changed" ? t("automations.cursorReview.changed")
      : issue === "event_problem" ? t("automations.cursorReview.eventProblem") : t("automations.cursorReview.unavailable");
  return <div role="alert" data-app-cursor-warning={issue} className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-[13px] leading-relaxed text-danger">{message}</div>;
}
