import { t } from "@/lib/i18n";
import { ConfirmDialog } from "../ConfirmDialog";

export function WorkflowShareConfirm({ open, wholeTeam = false, onCancel, onConfirm }: { open: boolean; wholeTeam?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <ConfirmDialog open={open} title={t("skillBurger.share.title")} body={t(wholeTeam ? "skillBurger.share.teamBody" : "skillBurger.share.botBody")}
    confirmLabel={t("skillBurger.share.confirm")} onCancel={onCancel} onConfirm={onConfirm} />;
}
