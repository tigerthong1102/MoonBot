import { useState } from "react";
import { t } from "@/lib/i18n";
import { useBotEditor } from "./BotEditorContext";
import type { ManagedSkill } from "./SkillsSection";

type Action = "pin" | "unpin" | "archive" | "restore";
type Dependency = "routine" | "workflow" | "team" | "template";
interface Review { text: string; revision: string; dependencies: Dependency[]; similar: string[] }

export function SkillMaintenance({ botId, skill, refresh }: { botId: string; skill: ManagedSkill; refresh(): Promise<void> }) {
  const { request } = useBotEditor();
  const [review, setReview] = useState<Review>();
  const [other, setOther] = useState<{ name: string; review: Review }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/bots/${botId}/skills/${encodeURIComponent(skill.name)}`;
  async function work(action?: Action | "consolidate") {
    setBusy(true);
    setError("");
    try {
      if (!action) { setOther(undefined); setReview(await request(base + "?maintenance=1")); }
      else if (review) {
        await request(base, { method: "PATCH", body: JSON.stringify({ maintenance: action, revision: review.revision, ...(action === "consolidate" && other ? { keep: other.name, keepRevision: other.review.revision } : {}) }) });
        setReview(undefined);
        await refresh();
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  async function compare(name: string) {
    setBusy(true); setError("");
    try { setOther({ name, review: await request(`/api/bots/${botId}/skills/${encodeURIComponent(name)}?maintenance=1`) }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  const button = "rounded-md px-2 py-1 text-[12px] text-accent hover:bg-raised disabled:opacity-40";
  return <div className="px-2 text-[12px] text-ink-secondary">
    <button type="button" disabled={busy} aria-expanded={Boolean(review)} className={button}
      onClick={() => review ? setReview(undefined) : void work()}>{t("skills.maintenance.review")}</button>
    {review && <div className="space-y-1 p-2">
      {review.dependencies.map(kind => <p key={kind}>{t(`skills.maintenance.dep.${kind}`)}</p>)}
      {review.similar.length > 0 && <p>{t("skills.maintenance.similar", { names: review.similar.join(", ") })}</p>}
      {!skill.archivedFrom && review.similar.map(name => <button key={name} type="button" disabled={busy} className={button} onClick={() => void compare(name)}>{t("skills.maintenance.compare", { name })}</button>)}
      {other && <div className="space-y-2">
        {[{ name: skill.name, text: review.text }, { name: other.name, text: other.review.text }].map(item =>
          <div key={item.name}><b>{item.name}</b><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{item.text}</pre></div>)}
        <button type="button" disabled={busy || skill.maintenancePinned || Boolean(review.dependencies.length)} className={button}
          onClick={() => void work("consolidate")}>{t("skills.maintenance.consolidate", { keep: other.name, archive: skill.name })}</button>
      </div>}
      <button type="button" disabled={busy} className={button} onClick={() => void work(skill.maintenancePinned ? "unpin" : "pin")}>{t(skill.maintenancePinned ? "skills.maintenance.unpin" : "skills.maintenance.pin")}</button>
      <button type="button" disabled={busy || (!skill.archivedFrom && (skill.maintenancePinned || Boolean(review.dependencies.length)))} className={button}
        onClick={() => void work(skill.archivedFrom ? "restore" : "archive")}>{t(skill.archivedFrom ? "skills.maintenance.restore" : "skills.maintenance.archive")}</button>
    </div>}
    {error && <div role="alert" className="text-warning">{error}</div>}
  </div>;
}
