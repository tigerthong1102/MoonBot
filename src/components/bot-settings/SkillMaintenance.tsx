import { useState } from "react";
import { t } from "@/lib/i18n";
import { useBotEditor } from "./BotEditorContext";
import type { ManagedSkill } from "./SkillsSection";

type Action = "pin" | "unpin" | "archive" | "restore";
type Dependency = "routine" | "workflow" | "team" | "template";
interface Review { revision: string; dependencies: Dependency[]; similar: string[] }

export function SkillMaintenance({ botId, skill, refresh }: { botId: string; skill: ManagedSkill; refresh(): Promise<void> }) {
  const { request } = useBotEditor();
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/bots/${botId}/skills/${encodeURIComponent(skill.name)}`;
  async function work(action?: Action) {
    setBusy(true);
    setError("");
    try {
      if (!action) setReview(await request(base + "?maintenance=1"));
      else if (review) {
        await request(base, { method: "PATCH", body: JSON.stringify({ maintenance: action, revision: review.revision }) });
        setReview(undefined);
        await refresh();
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  const button = "rounded-md px-2 py-1 text-[12px] text-accent hover:bg-raised disabled:opacity-40";
  return <div className="px-2 text-[12px] text-ink-secondary">
    <button type="button" disabled={busy} aria-expanded={Boolean(review)} className={button}
      onClick={() => review ? setReview(undefined) : void work()}>{t("skills.maintenance.review")}</button>
    {review && <div className="space-y-1 p-2">
      {review.dependencies.map(kind => <p key={kind}>{t(`skills.maintenance.dep.${kind}`)}</p>)}
      {review.similar.length > 0 && <p>{t("skills.maintenance.similar", { names: review.similar.join(", ") })}</p>}
      <button type="button" disabled={busy} className={button} onClick={() => void work(skill.maintenancePinned ? "unpin" : "pin")}>{t(skill.maintenancePinned ? "skills.maintenance.unpin" : "skills.maintenance.pin")}</button>
      <button type="button" disabled={busy || (!skill.archivedFrom && (skill.maintenancePinned || Boolean(review.dependencies.length)))} className={button}
        onClick={() => void work(skill.archivedFrom ? "restore" : "archive")}>{t(skill.archivedFrom ? "skills.maintenance.restore" : "skills.maintenance.archive")}</button>
    </div>}
    {error && <div role="alert" className="text-warning">{error}</div>}
  </div>;
}
