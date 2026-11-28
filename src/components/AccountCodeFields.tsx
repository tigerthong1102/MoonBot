import { t } from "@/lib/i18n";
import type { PhoneSetupController } from "./PhoneSetupFlow";

export function AccountCodeFields({ controller: c, mode, actionError }: { controller: PhoneSetupController; mode?: "account"; actionError?: string | null }) {
  const canSubmitEmail = /^\S+@\S+\.\S+$/.test(c.email.trim());
  return (
    <div className="mt-5 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-secondary">{t("phone.signIn.email")}</span>
        <input
          autoFocus={mode !== "account"}
          autoComplete="email"
          inputMode="email"
          value={c.email}
          disabled={c.accountBusy || c.codeSent}
          onChange={(event) => c.setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !c.codeSent && canSubmitEmail) c.requestCode();
          }}
          placeholder={t("common.emailPlaceholder")}
          className="rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent disabled:opacity-50"
        />
      </label>
      {c.codeSent && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-secondary">{t("phone.signIn.emailCode")}</span>
          <input
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            value={c.code}
            disabled={c.accountBusy}
            onChange={(event) => c.setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && c.code.length === 8) c.verifyCode(mode);
            }}
            placeholder="12345678"
            className="rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 font-mono text-[16px] tracking-[0.18em] text-ink outline-none placeholder:tracking-normal placeholder:text-ink-tertiary focus:border-accent disabled:opacity-50"
          />
        </label>
      )}
      <button
        disabled={c.accountBusy || (!c.codeSent && !canSubmitEmail) || (c.codeSent && c.code.length !== 8)}
        onClick={() => c.codeSent ? c.verifyCode(mode) : c.requestCode()}
        className="rounded-lg bg-accent py-2.5 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        {c.accountBusy ? t("phone.signIn.working") : c.codeSent ? t("phone.signIn.verify") : t("phone.signIn.sendCode")}
      </button>
      {c.codeSent && (
        <button
          disabled={c.accountBusy}
          onClick={c.changeEmail}
          className="text-[12px] text-ink-secondary hover:text-ink disabled:opacity-40"
        >
          {t("phone.signIn.otherEmail")}
        </button>
      )}
      {c.codeSent && !actionError && (
        <p className="text-[12px] text-ink-secondary">{t("phone.signIn.expires")}</p>
      )}
    </div>
  );
}
