import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { onSnoozeChanged, setBotSnooze, snoozedUntil, SNOOZE_HOUR } from "@/lib/bot-notification-snooze";
export function SnoozeBotNotifications({ id }: { id: string }) {
  const [until, setUntil] = useState(() => snoozedUntil(id));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const update = () => setUntil(snoozedUntil(id));
    update();
    const off = onSnoozeChanged(update);
    const timer = until ? window.setTimeout(update, Math.max(0, until - Date.now()) + 1) : undefined;
    return () => { off(); window.clearTimeout(timer); };
  }, [id, until]);
  return <div className="px-3 py-1.5 text-xs">
    <button type="button" className="text-accent" onClick={() => {
      try { setBotSnooze(id, until ? 0 : Date.now() + SNOOZE_HOUR); setFailed(false); } catch { setFailed(true); }
    }}>{t(until ? "notify.snooze.resume" : "notify.snooze.hour")}</button>
    {failed && <span role="alert">{t("notify.snooze.failed")}</span>}
  </div>;
}
