import type { HeldAppEventReview } from "../../../shared/app-triggers";
import { t } from "@/lib/i18n";

export function HeldAppEventReviews({ reviews, botName, onOpen }: {
  reviews: HeldAppEventReview[];
  botName(id: string): string;
  onOpen(triggerId: string): void;
}) {
  if (!reviews.length) return null;
  return <section aria-label={t("automations.held.title")} className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-[13px]">
    <h2 className="font-semibold text-danger">{t("automations.held.title")}</h2>
    <ul className="divide-y divide-hairline/40">
      {reviews.map(row => <li key={row.key} className="space-y-1 py-2">
        <time>{new Date(row.receivedAt).toLocaleString()}</time>
        <p className="text-danger">{t(row.reason === "conflict" ? "automations.held.conflict" : "automations.held.unknown")}</p>
        {row.triggers.map(trigger => <button key={trigger.id} type="button" className="mr-2 rounded py-1 text-accent-text" onClick={() => onOpen(trigger.id)}>
          {t("automations.held.open", { name: trigger.name, bot: botName(trigger.botId) })}
        </button>)}
      </li>)}
    </ul>
  </section>;
}
