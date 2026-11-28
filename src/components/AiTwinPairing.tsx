import { AiTwinGeneratedRelease } from "./AiTwinGeneratedRelease";
import { AiTwinExactRelease } from "./AiTwinExactRelease";
import { useState } from "react";
import { t } from "@/lib/i18n";

export function AiTwinPairing() {
  const bridge = window.ogb?.personalInbox;
  const [ticket, setTicket] = useState<{
    id: string;
    fingerprint: string;
    origin: string;
    exactAvailable?: boolean;
    generatedAvailable?: boolean;
  }>();
  const [generatedAvailable, setGeneratedAvailable] = useState(false);
  const [exactAvailable, setExactAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!bridge?.startTwinPairing || !bridge.confirmTwinPairing) return null;
  async function act(confirm: boolean) {
    setBusy(true);
    setNotice("");
    try {
      if (confirm) {
        if (await bridge!.confirmTwinPairing!()) setNotice(t("personalInbox.pairFinish"));
      } else {
        setTicket(undefined);
        setTicket(await bridge!.startTwinPairing!());
      }
    } catch {
      setNotice(t("personalInbox.pairError"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(event) => {
        if (event.target !== event.currentTarget || !event.currentTarget.open) return;
        void bridge.generatedStatus?.()
          .then(s => setGeneratedAvailable(s.available || s.pendingRecovery === true)).catch(() => {});
        void bridge.exactStatus?.()
          .then(s => setExactAvailable(s.available || s.pendingRecovery === true)).catch(() => {});
      }}
    >
      <summary>{t("personalInbox.pairTitle")}</summary>
      <p>{t("personalInbox.pairPurpose")}</p>
      <button type="button" className="ui-button" disabled={busy} onClick={() => void act(false)}>
        {t("personalInbox.pairStart")}
      </button>
      {ticket && (
        <div className="grid min-w-0 gap-2">
          <p>{t("personalInbox.pairDesktopHelp")}</p>
          <code dir="ltr" className="break-all">
            {ticket.origin}
          </code>
          <label>
            {t("personalInbox.pairCode")}{" "}
            <code dir="ltr" className="select-all break-all">
              {ticket.id}
            </code>
          </label>
          <label>
            {t("personalInbox.pairFingerprint")}{" "}
            <code dir="ltr" className="select-all break-all">
              {ticket.fingerprint}
            </code>
          </label>
          <button type="button" className="ui-button" disabled={busy} onClick={() => void act(true)}>
            {t("personalInbox.pairMatch")}
          </button>
        </div>
      )}
      {(exactAvailable || ticket?.exactAvailable) && <AiTwinExactRelease paired={!!ticket?.exactAvailable} />}
      {(generatedAvailable || ticket?.generatedAvailable) && <AiTwinGeneratedRelease paired={!!ticket?.generatedAvailable} />}
      <p role="status">{notice}</p>
    </details>
  );
}
