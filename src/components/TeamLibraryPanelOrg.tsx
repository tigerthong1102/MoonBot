import { useState } from "react";
import { Building2, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  orgCardAction,
  orgCardNotes,
  orgContentsLine,
  orgModeBadge,
  orgPublisherLine,
  type OrgLibraryListing,
  type OrgLibraryPackage,
} from "@/lib/org-library";

const GLYPHS = [
  "bg-cyan-500/15 text-cyan-300",
  "bg-purple-500/15 text-purple-300",
  "bg-emerald-500/15 text-emerald-300",
  "bg-orange-500/15 text-orange-300",
] as const;

export function OrgLibraryTab({
  listing,
  busy,
  notice,
  error,
  onAdd,
  onDetails,
  onUpdate,
}: {
  listing: OrgLibraryListing & { organization: { id: string; name: string } };
  busy: string | null;
  notice: string;
  error: string;
  onAdd: (entry: OrgLibraryPackage) => void;
  onDetails: (entry: OrgLibraryPackage) => void;
  onUpdate?: (entry: OrgLibraryPackage, approved: string[]) => void;
}) {
  const name = listing.organization.name;
  return (
    <div>
      <p className="max-w-2xl text-[13px] leading-relaxed text-ink-secondary">{t("orgLibrary.intro", { name })}</p>
      {listing.packages.length === 0 ? (
        <p className="mt-6 text-[13px] text-ink-secondary">{t("orgLibrary.empty", { name })}</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-x-10 md:grid-cols-2">
          {listing.packages.map((entry, index) => (
            <OrgPackageCard key={entry.packageId} entry={entry} index={index} busy={busy} onAdd={onAdd} onDetails={onDetails} onUpdate={onUpdate} />
          ))}
        </div>
      )}
      {notice && <div role="status" className="mt-4 rounded-lg bg-raised/60 px-3 py-2 text-[13px] text-ink-secondary">{notice}</div>}
      {error && <div role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</div>}
    </div>
  );
}

function OrgPackageCard({
  entry,
  index,
  busy,
  onAdd,
  onDetails,
  onUpdate,
}: {
  entry: OrgLibraryPackage;
  index: number;
  busy: string | null;
  onAdd: (entry: OrgLibraryPackage) => void;
  onDetails: (entry: OrgLibraryPackage) => void;
  onUpdate?: (entry: OrgLibraryPackage, approved: string[]) => void;
}) {
  const action = orgCardAction(entry);
  const badge = orgModeBadge(entry);
  const notes = orgCardNotes(entry);
  const adding = busy === entry.packageId;
  return (
    <article className="flex min-h-[104px] items-center gap-3 border-b border-hairline/35 px-1 py-4">
      <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", GLYPHS[index % GLYPHS.length])}>
        <Building2 size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[14px] font-medium text-ink">{entry.name}</h3>
        <p className="mt-0.5 truncate text-[13px] text-ink-secondary">{entry.tagline}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-tertiary">
          <span>{orgPublisherLine(entry)}</span>
          {badge && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent-text">{badge}</span>}
          {entry.release && <span>{entry.release.version}</span>}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-ink-tertiary">{orgContentsLine(entry.contents)}</p>
        {entry.updateReview && onUpdate && <ConsentUpdate key={entry.updateReview.target} entry={entry} busy={busy !== null} update={onUpdate} />}
        {notes.map((note) => <p key={note} className="mt-0.5 text-[12px] text-warning">{note}</p>)}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {action === "add" && (
          <button
            onClick={() => onAdd(entry)}
            disabled={busy !== null}
            aria-label={t("orgLibrary.addAria", { name: entry.name })}
            className="flex min-w-[72px] items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
          >
            {adding && <Loader2 size={13} className="animate-spin" />}
            {adding ? t("orgLibrary.adding") : t("orgLibrary.add")}
          </button>
        )}
        {action === "added" && (
          <span className="flex items-center gap-1 rounded-full bg-raised px-3 py-1.5 text-[12px] text-ink-secondary">
            <Check size={13} className="text-success" />{t("orgLibrary.added")}
          </span>
        )}
        {action === "updateApp" && <span className="max-w-[140px] text-right text-[12px] text-ink-secondary">{t("orgLibrary.updateApp")}</span>}
        {action === "notReady" && <span className="text-[12px] text-ink-secondary">{t("orgLibrary.notReady")}</span>}
        {action === "noRelease" && <span className="text-[12px] text-ink-secondary">{t("orgLibrary.noRelease")}</span>}
        {entry.blob === "ready" && (
          <button
            onClick={() => onDetails(entry)}
            disabled={busy !== null}
            aria-label={t("orgLibrary.detailsAria", { name: entry.name })}
            className="rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
          >
            {t("orgLibrary.details")}
          </button>
        )}
      </div>
    </article>
  );
}

function ConsentUpdate({ entry, busy, update }: { entry: OrgLibraryPackage; busy: boolean; update(entry: OrgLibraryPackage, approved: string[]): void }) {
  const review = entry.updateReview!;
  const [checked, setChecked] = useState<string[]>([]);
  return <details className="mt-2 text-xs">
    <summary className="cursor-pointer">{t("orgLibrary.reviewUpdate")}</summary>
    <p className="my-2 break-all">{entry.ref} · {entry.installed?.release} → {entry.release?.version} · SHA-256 {review.target}</p>
    {review.baselineMissing && <p>{t("orgLibrary.baselineMissing")}</p>}
    {review.added.map(item => <label className="my-1 block break-all" key={item}>
      <input type="checkbox" checked={checked.includes(item)} onChange={e => setChecked(current => e.target.checked ? [...current, item] : current.filter(value => value !== item))} /> {item}
    </label>)}
    {review.removed.map(item => <p key={item}>− {item}</p>)}
    <button type="button" className="ui-button ui-button-sm" disabled={busy || checked.length !== review.added.length}
      onClick={() => update(entry, checked)}>{t("orgLibrary.approveUpdate")}</button>
  </details>;
}
