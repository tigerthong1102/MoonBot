import { useEffect, useRef, useState } from "react";
import { Ear, MicOff } from "lucide-react";
import { t } from "@/lib/i18n";
import { listenForWakePhrase, type WakeState } from "@/lib/wake-phrase";

type Status = "off" | "requesting" | "denied" | WakeState;
export function WakePhraseButton({ onWake }: { onWake(): void }) {
  const [status, setStatus] = useState<Status>("off");
  const session = useRef<AbortController | null>(null);
  const latest = useRef(onWake);
  latest.current = onWake;
  const stop = (next: Status = "off") => { session.current?.abort(); session.current = null; setStatus(next); };
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); session.current?.abort(); };
  }, []);
  const active = status !== "off" && status !== "denied";
  const label = t(active ? "call.wake.stop" : "call.wake.start");
  const toggle = () => {
    if (session.current) { stop(); return; }
    const controller = new AbortController();
    session.current = controller;
    setStatus("requesting");
    const current = () => !controller.signal.aborted && session.current === controller;
    void listenForWakePhrase(controller.signal, next => { if (current()) setStatus(next); },
      () => { if (current()) { stop(); latest.current(); } },
      () => { if (current()) stop("denied"); })
      .catch(() => { if (current()) stop("denied"); });
  };
  return <div className="relative flex items-center">
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={toggle}
      className="grid size-8 place-items-center rounded-full text-ink-secondary hover:bg-control focus-visible:outline-accent">
      {active ? <MicOff size={15} className="text-accent" /> : <Ear size={15} />}
    </button>
    {status !== "off" && <span role="status" className="absolute bottom-full right-0 z-10 mb-1 w-max max-w-56 rounded-lg bg-raised px-2 py-1 text-xs text-ink shadow-sm">{t(`call.wake.${status}`)}</span>}
  </div>;
}
