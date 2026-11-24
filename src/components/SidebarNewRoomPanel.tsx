import { useRef, useState, type KeyboardEvent } from "react";
import { track } from "@/lib/analytics";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { imeComposing } from "@/lib/send-key";
import { BotPickerList } from "./BotPickerList";
import { EmailCodeForm } from "./EmailCodeForm";
import { Layer } from "./Layer";
import { FIELD, PRIMARY_WIDE } from "./cloud-buy/parts";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import type { LocaleKey } from "@/locales";

export function NewRoomPanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const bridge = window.ogb?.personalInbox;
  const account = window.ogb?.personalAccount;
  const dialog = useRef<HTMLDivElement>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const [addressees, setAddressees] = useState("");
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [error, setError] = useState<LocaleKey | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useModalDialog(dialog, () => { if (!busy) onClose(); });
  const emails = [...new Set(addressees.trim().toLowerCase().split(/[\s,;]+/).filter(Boolean).map(address => address.replace(/^@/, "")))];
  const withPeople = Boolean(bridge && emails.length);
  const bots = state.bots.filter((b) => !b.hidden);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const create = async () => {
    if (busy) return;
    if (withPeople && bridge) {
      setError(null);
      const title = name.trim();
      if (emails.length > 8 || emails.some(email => email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
        setError("personalInbox.invalidInput");
        return;
      }
      if (emails.length > 1 && !title) {
        setError("personalInbox.groupNameRequired");
        return;
      }
      const key = JSON.stringify([title, emails]);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      setBusy(true);
      try {
        const result = await bridge.create({ id: attempt.current.id, title, emails });
        if (result === "ok") onClose();
        else if (result === "unauthorized" && account) setSignIn(true);
        else setError(result === "invalid_request" ? "personalInbox.invalidInput"
          : result === "rate_limited" ? "personalInbox.rateLimit"
          : result === "room_limit_or_conflict" ? "personalInbox.roomLimit"
          : "settings.account.connectionFailed");
      } catch {
        setError("settings.account.connectionFailed");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!picked.size) return;
    dispatch({
      type: "createGroup",
      memberIds: [...picked],
      name: name.trim() || undefined,
      section: section.trim() || undefined,
    });
    track("room_created", { members: picked.size, context: Boolean(section.trim()) });
    onClose();
  };
  const enter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!imeComposing(event.nativeEvent)) void create();
  };
  const direct = withPeople && emails.length === 1 && !name.trim();
  return (
    <Layer modal><div
      className="ui-scrim fixed inset-0 z-40 flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="new-group-title" tabIndex={-1}
        className="max-h-[90dvh] w-full max-w-[400px] overflow-auto rounded-2xl border border-hairline bg-card p-4 shadow-2xl">
        <h2 id="new-group-title" className="mb-3 text-[17px] font-semibold text-ink">{t(signIn ? "personalInbox.signInTitle" : "sidebar.newChannel.title")}</h2>
        {signIn && account ? <EmailCodeForm sendCode={account.sendCode} verifyCode={account.verify} complete={() => {
          setSignIn(false);
          void create();
        }} /> : <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void create(); }}>
        {bridge && <label className="grid gap-1.5 text-sm text-ink">
          {t("personalInbox.groupRecipients")}
          <input autoFocus dir="ltr" inputMode="email" className={FIELD} value={addressees} maxLength={2050}
            aria-describedby={withPeople ? "new-group-recipients-hint" : undefined}
            disabled={busy} placeholder="@email@example.com" onChange={event => { setAddressees(event.target.value); setError(null); }}
            onKeyDown={enter} />
        </label>}
        {withPeople && <small id="new-group-recipients-hint" className="text-xs text-ink-secondary">{t("personalInbox.emailRecipientsHint")}</small>}
        <input
          autoFocus={!bridge}
          maxLength={withPeople ? 80 : 100}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={enter}
          aria-label={t("sidebar.newChannel.nameLabel")}
          placeholder={t(withPeople ? "personalInbox.groupName" : "sidebar.newChannel.name")}
          className={FIELD}
        />
        {!withPeople && <>
        <input
          value={section}
          maxLength={60}
          onChange={(e) => setSection(e.target.value)}
          onKeyDown={enter}
          placeholder={t("sidebar.newChannel.context")}
          aria-label={t("sidebar.newChannel.contextAria")}
          className={FIELD}
        />
        <BotPickerList
          bots={bots}
          picked={picked}
          onToggle={toggle}
          emptyHint={t("sidebar.newChannel.emptyHint")}
        />
        </>}
        {error && <p role="alert" className="text-sm text-danger">{t(error)}</p>}
        <button
          type="submit"
          disabled={busy || (!withPeople && !picked.size)}
          className={PRIMARY_WIDE}
        >
          {withPeople ? t(direct ? "personalInbox.openChat" : "personalInbox.createGroup") : picked.size === 0
            ? t("sidebar.newChannel.create")
            : picked.size === 1
              ? t("sidebar.newChannel.createOne")
              : t("sidebar.newChannel.createMany", { count: picked.size })}
        </button>
        </form>}
      </div>
    </div></Layer>
  );
}
