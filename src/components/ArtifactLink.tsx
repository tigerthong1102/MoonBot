import { useState } from "react";
import { Link2 } from "lucide-react";
import type { MessageAttachmentContext } from "./AttachmentPreview";
import { useCopyFeedback } from "@/lib/copy-text";
import { intlLocale, t } from "@/lib/i18n";
import { api } from "@/state/store";

export function ArtifactLink({ path, message }: { path: string; message: MessageAttachmentContext }) {
  const [link, setLink] = useState<{ id: string; url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { state, copy } = useCopyFeedback(link?.url ?? "");
  const endpoint = `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file`;
  async function change() {
    setBusy(true);
    setError("");
    try {
      if (link) {
        await api(endpoint, { method: "POST", body: JSON.stringify({ revokeArtifact: link.id }) });
        setLink(null);
      } else {
        const grant = await api<{ id: string; url: string; expiresAt: number }>(endpoint, { method: "POST", body: JSON.stringify({ path, shareArtifact: true }) });
        setLink({ ...grant, url: new URL(grant.url, location.origin).href });
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (!message.botOutput) return null;
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    {link && <><span>{t("artifact.link.scope", { time: new Date(link.expiresAt).toLocaleString(intlLocale()) })}</span>
      <button type="button" onClick={copy}>{t(state === "copied" ? "chat.page.copied" : "chat.page.copyLink")}</button></>}
    <button type="button" className="table-action" disabled={busy} onClick={change} title={t(link ? "artifact.link.revoke" : "artifact.link.create")} aria-label={t(link ? "artifact.link.revoke" : "artifact.link.create")}>
      {link ? t("artifact.link.revoke") : <Link2 size={14} />}
    </button>
    {error && <span role="alert" className="text-danger">{error}</span>}
  </div>;
}
