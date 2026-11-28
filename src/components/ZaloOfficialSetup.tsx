import { useEffect, useRef, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";
import { localSetupImport } from "@/lib/setup-import";
import { api, ApiError } from "@/state/api";

const path = "/api/zalo-official/probe";
const request = { mode: "same-origin", redirect: "error", cache: "no-store" } as const;
const localPage = () => localSetupImport(false) && ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);

interface Probe {
  identityVerified: true;
  accountId: string;
  accountName?: string;
  webhookConfigured: boolean | null;
}

export function ZaloOfficialSetup() {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Probe | null>(null);
  const [issue, setIssue] = useState<"zaloOfficial.invalid" | "zaloOfficial.failed" | null>(null);
  useEffect(() => {
    if (!localPage()) return;
    const controller = new AbortController();
    void api<{ enabled: boolean }>(path, { ...request, signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setAvailable(value.enabled === true);
    }).catch(() => {});
    return () => { controller.abort(); pending.current?.abort(); };
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || !localPage() || pending.current || !input.current) return;
    const token = input.current.value.trim();
    input.current.value = "";
    if (!token) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setIssue(null);
    setResult(null);
    try {
      const value = await api<Probe>(path, {
        ...request, method: "POST", body: JSON.stringify({ token }), signal: controller.signal, timeoutMs: 12_000,
      });
      if (value.identityVerified !== true || typeof value.accountId !== "string" ||
        (typeof value.webhookConfigured !== "boolean" && value.webhookConfigured !== null)) throw new Error("invalid-probe");
      if (!controller.signal.aborted) setResult(value);
    } catch (error) {
      if (!controller.signal.aborted) setIssue(error instanceof ApiError && ["configuration", "authentication"].includes(String(error.body?.error))
        ? "zaloOfficial.invalid" : "zaloOfficial.failed");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (!available) return null;
  return <section className="rounded-xl bg-card p-4">
    <h3 className="text-sm font-medium text-ink">{t("zaloOfficial.title")}</h3>
    <p className="mt-1 text-xs text-ink-secondary">{t("zaloOfficial.privacy")}</p>
    <form autoComplete="off" onSubmit={verify} className="mt-3 flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">{t("zaloOfficial.token")}
        <input ref={input} type="password" autoComplete="off" spellCheck={false} required maxLength={289} disabled={busy}
          className="rounded-md border border-line bg-card px-2 py-1 text-ink" />
      </label>
      <button className="ui-button" type="submit" disabled={busy}>{t(busy ? "zaloOfficial.checking" : "zaloOfficial.verify")}</button>
    </form>
    {issue && <p role="alert" className="mt-2 text-sm">{t(issue)}</p>}
    {result && <div role="status" className="mt-2 grid gap-1 text-sm text-ink-secondary">
      <p>{t("zaloOfficial.identity", { bot: result.accountName ? `${result.accountName} (${result.accountId})` : result.accountId })}</p>
      <p>{t(result.webhookConfigured === null ? "zaloOfficial.unknown" : result.webhookConfigured ? "zaloOfficial.webhook" : "zaloOfficial.empty")}</p>
    </div>}
  </section>;
}
