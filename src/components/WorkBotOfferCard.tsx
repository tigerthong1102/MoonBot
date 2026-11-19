import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useCloudGuest } from "@/lib/cloud-guest";
import { t } from "@/lib/i18n";
import { useStore, type OptionCardData } from "@/state/store";
import { ASK_SECONDARY_BUTTON, askPrimary } from "./AskCard";

export function WorkBotOfferCard({ card, threadId }: { card: OptionCardData; threadId?: string }) {
  const { state, dispatch } = useStore();
  const guest = useCloudGuest();
  const canAnswer = useOwnerOrAdmin() !== false && !guest;
  const result = card.teamSetupRequest?.result;
  const created = result?.bots.find(bot => bot.action === "created");
  const available = created && state.bots.some(bot => bot.id === created.id && !bot.hidden);
  const pending = !card.answered && !card.dismissed && !card.expired && !result;
  const decide = (behavior: "allow" | "deny") => {
    if (threadId && card.requestId) dispatch({ type: "decideRequest", threadId, requestId: card.requestId, behavior });
  };

  return <section data-work-bot-offer className="w-full max-w-[640px] rounded-2xl border border-hairline bg-card p-4">
    <p className="font-semibold text-ink">{created ? t("workBotOffer.created", { name: created.name }) : card.title}</p>
    {pending && <p className="mt-2 whitespace-pre-line break-words text-sm text-ink-secondary">{card.subtitle}</p>}
    {pending && threadId && canAnswer && <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => decide("allow")} className={askPrimary(undefined).className}>{card.options[0]}</button>
      <button type="button" onClick={() => decide("deny")} className={ASK_SECONDARY_BUTTON}>{t("notice.notNow")}</button>
    </div>}
    {pending && !canAnswer && <p className="mt-2 text-sm">{t("chat.cloudGuest.ownerApproves")}</p>}
    {!pending && <div role="status" className="mt-2 text-sm text-ink-secondary">
      {created ? available
        ? <button type="button" className={ASK_SECONDARY_BUTTON} onClick={() => dispatch({ type: "select", id: created.id })}>{t("canvas.openBotChat", { name: created.name })}</button>
        : null
        : card.held ?? t(card.expired ? "approval.status.expired" : "approval.status.cancelled")}
    </div>}
  </section>;
}
