import { useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import type { LoginSummary } from "../../shared/logins";
import { Select } from "./Select";
import { SETTINGS_INPUT } from "./SettingsPrimitives";

export function BitwardenGrantForm({ bots, grants, reload }: {
  bots: { id: string; name: string }[]; grants: LoginSummary[]; reload(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(method: "POST" | "DELETE", body: object) {
    setBusy(true); setError("");
    try { await api("/api/vault/bitwarden", { method, body: JSON.stringify(body) }); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : t("settings.vault.loadError")); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const body = { item: data.get("item"), session: data.get("session"), host: data.get("host"), bots: [data.get("bot")] };
    form.reset();
    void save("POST", body);
  }
  return <details className="p-4"><summary>Bitwarden</summary>
    <form onSubmit={submit} className="mt-2 grid gap-2">
      <label>{t("settings.vault.bitwardenItem")}<input name="item" required className={SETTINGS_INPUT} /></label>
      <label>{t("settings.vault.bitwardenSession")}<input name="session" type="password" required autoComplete="off" className={SETTINGS_INPUT} /></label>
      <label>{t("logins.site")}<input name="host" required placeholder="accounts.example.com" className={SETTINGS_INPUT} /></label>
      <Select name="bot" aria-label={t("routines.drawer.bot")} required>{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</Select>
      <button disabled={busy || bots.length === 0} className="ui-button">{t("settings.vault.bitwardenGrant")}</button>
    </form>
    {grants.map(login => <button key={login.id} disabled={busy} className="ui-button" onClick={() => void save("DELETE", { item: login.id.slice(3) })}>
      {t("people.remove")} · {login.site} · {login.username}</button>)}
    {error && <p role="alert">{error}</p>}
  </details>;
}
