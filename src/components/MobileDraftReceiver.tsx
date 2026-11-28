import { useLayoutEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";

export function MobileDraftReceiver({ receive }: { receive: (prompt: string) => void }) {
  const [armed, setArmed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const apply = useRef(receive);
  useLayoutEffect(() => {
    apply.current = receive;
  }, [receive]);
  useLayoutEffect(() => {
    const bridge = window.ogb?.mobileDraft;
    if (!armed || !bridge) return;
    const listener = armed;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const disarm = () => setArmed(null);
    function stop() {
      disposed = true;
      clearTimeout(timer);
      void bridge?.("close", listener).catch(() => {});
    }
    function blur() {
      stop();
      disarm();
    }
    async function poll() {
      if (disposed || !bridge) return;
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        blur();
        return;
      }
      try {
        const draft = await bridge("poll", listener);
        if (disposed) return;
        if (draft && draft.expires > Date.now()) {
          if (!document.hasFocus()) {
            blur();
            return;
          }
          // Only fill an empty private composer. The existing Send action retains all tool approval checks.
          apply.current(draft.prompt);
          await bridge("ack", listener, draft.id);
          disarm();
          return;
        }
        timer = setTimeout(poll, 2500);
      } catch {
        if (!disposed) {
          setFailed(true);
          disarm();
        }
      }
    }
    void bridge("open", listener)
      .then(poll)
      .catch(() => {
        if (!disposed) {
          setFailed(true);
          disarm();
        }
      });
    window.addEventListener("blur", blur);
    return () => {
      stop();
      window.removeEventListener("blur", blur);
    };
  }, [armed]);
  if (!window.ogb?.mobileDraft) return null;
  return (
    <div className="pointer-events-auto mb-1 text-xs">
      <button
        type="button"
        className="ui-button"
        aria-pressed={Boolean(armed)}
        onClick={() => {
          setFailed(false);
          setArmed(armed ? null : crypto.randomUUID());
        }}
      >
        {t(armed ? "mobileChat.desktopListening" : "mobileChat.desktopListen")}
        {armed && " · " + armed.slice(0, 8)}
      </button>
      {failed && <span role="status">{t("mobileChat.desktop_unavailable")}</span>}
    </div>
  );
}
