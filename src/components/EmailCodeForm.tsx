import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { FIELD, LINK, PRIMARY_WIDE } from "./cloud-buy/parts";

type Result = "ok" | "invalid" | "limited" | "unavailable";
export function EmailCodeForm({ sendCode, verifyCode, complete }: {
  sendCode(email: string): Promise<Result>;
  verifyCode(email: string, code: string): Promise<Result>;
  complete(): void;
}) {
  const codeField = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [error, setError] = useState<LocaleKey | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (sent) codeField.current?.focus(); }, [sent]);
  useEffect(() => {
    if (!resendAt) return;
    const timer = setTimeout(() => setResendAt(0), Math.max(0, resendAt - Date.now()));
    return () => clearTimeout(timer);
  }, [resendAt]);
  async function submit(verify: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = verify ? await verifyCode(email.trim(), code) : await sendCode(email.trim());
      if (!mounted.current) return;
      if (result === "ok") {
        if (verify) complete();
        else { setSent(true); setCode(""); setResendAt(Date.now() + 60_000); }
      } else {
        setError(result === "limited" ? "personalInbox.rateLimit" : result === "unavailable" ? "settings.account.connectionFailed" : verify ? "personalInbox.invalidCode" : "cloudBuy.signIn.invalidEmail");
      }
    } catch {
      if (mounted.current) setError("settings.account.connectionFailed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return <form className="flex w-full flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(sent); }}>
    {sent ? <label className="grid gap-2 text-sm">{t("cloudBuy.signIn.codeLabel", { email })}
      <input className={FIELD} ref={codeField} autoComplete="one-time-code" inputMode="numeric" dir="ltr" name="otp" pattern="[0-9]{8}" maxLength={8} required value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, "")); setError(null); }} />
    </label> : <label className="grid gap-2 text-sm">{t("personalInbox.yourEmail")}
      <input className={FIELD} autoFocus type="email" name="email" dir="ltr" maxLength={254} autoComplete="email" required readOnly={busy} value={email} onChange={event => { setEmail(event.target.value); setError(null); }} />
    </label>}
    {error && <p role="alert" className="text-sm text-danger">{t(error)}</p>}
    <button type="submit" disabled={busy || (sent && code.length !== 8)} className={PRIMARY_WIDE}>{t(sent ? "personalInbox.signIn" : "personalInbox.sendCode")}</button>
    {sent && <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className={LINK} disabled={busy} onClick={() => { setSent(false); setError(null); setCode(""); }}>{t("cloudBuy.signIn.change")}</button>
      <button type="button" className={LINK} disabled={busy || !!resendAt} onClick={() => void submit(false)}>{t(resendAt ? "personalInbox.resendWait" : "cloudBuy.signIn.resend")}</button>
    </div>}
  </form>;
}
