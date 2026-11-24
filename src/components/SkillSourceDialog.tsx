import { useRef, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import type { SkillsLibrarySkillWire } from "../../shared/wire";
import { SkillInstructions } from "./SkillInstructions";

export function SkillSourceDialog({ viewing, error, working, onClose, onEnable, enableLabel, details }: {
  viewing: { skill: Pick<SkillsLibrarySkillWire, "name" | "warnings">; text: string; review: boolean };
  error: string;
  working: boolean;
  onClose: () => void;
  onEnable: () => void;
  enableLabel: string;
  details?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  return (
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="skills-library-view-title"
          className="ui-scrim fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6"
        >
          <div className="ui-modal flex max-h-[min(760px,90dvh)] w-full max-w-2xl flex-col p-5">
            <div className="flex items-center justify-between gap-3">
              <div id="skills-library-view-title" className="text-[16px] font-semibold text-ink">{viewing.review ? t("skills.reviewTitle", { name: viewing.skill.name }) : viewing.skill.name}</div>
              <button
                type="button"
                disabled={working}
                onClick={onClose}
                className="rounded-md px-2 py-1 text-[13px] text-ink-secondary hover:bg-control hover:text-ink"
              >
                {t("skills.library.close")}
              </button>
            </div>
            {details}
            {viewing.skill.warnings.length > 0 && <div className="mt-2 text-[12px] text-warning">{viewing.skill.warnings.join(" · ")}</div>}
            <SkillInstructions name={viewing.skill.name} text={viewing.text} label={t("skills.library.view", { skill: viewing.skill.name })} />
            {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
            {viewing.review && <button type="button" disabled={working} onClick={onEnable} className="mt-4 self-end rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink disabled:opacity-40">{enableLabel}</button>}
          </div>
        </div>
  );
}
