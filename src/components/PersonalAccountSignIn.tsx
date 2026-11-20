import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t } from "@/lib/i18n";
import { EmailCodeForm } from "./EmailCodeForm";
import { useStoreDispatch } from "@/state/store-select";
import { Layer } from "./Layer";
import { CLOSE, SCREEN, SHEET } from "./cloud-buy/parts";

type Account = NonNullable<NonNullable<Window["ogb"]>["personalAccount"]>;

function EmailForm({ account, close, complete }: { account: Account; close(): void; complete(): void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalDialog(dialog, close);
  return <Layer modal><div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="personal-account-title" data-personal-account-dialog="" className={SHEET + " relative w-full max-w-[420px]"}>
      <button type="button" className={CLOSE + " absolute end-3 top-3"} aria-label={t("common.close")} onClick={close}><X size={16} /></button>
      <div className={SCREEN}>
        <h2 className="pe-8 text-[17px] font-medium" id="personal-account-title">{t("personalInbox.signInTitle")}</h2>
        <EmailCodeForm sendCode={account.sendCode} verifyCode={account.verify} complete={complete} />
      </div>
    </div>
  </div></Layer>;
}

export function PersonalAccountSignIn() {
  const account = window.ogb?.personalAccount;
  const dispatch = useStoreDispatch();
  const [inbox, setInbox] = useState<boolean | null>(null);
  useEffect(() => account?.onPrompt?.(openInbox => setInbox(previous => previous === true || openInbox)), [account]);
  if (!account || inbox === null) return null;
  return <EmailForm account={account} close={() => setInbox(null)} complete={() => {
    setInbox(null);
    if (inbox) void window.ogb?.openPersonalInbox?.().catch(() => dispatch({ type: "error", message: t("settings.account.connectionFailed") }));
  }} />;
}
