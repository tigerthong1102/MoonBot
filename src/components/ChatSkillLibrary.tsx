import { BookOpen, X } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { leadComposerDraft } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { Layer } from "./Layer";
import { SkillsSection, type SkillChatTarget } from "./SkillsSection";

function ChatLibraryDialog({ chat, close }: { chat: SkillChatTarget; close: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useModalDialog(panel, close);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3 sm:p-6">
      <div ref={panel} role="dialog" aria-modal="true" aria-label={t("skills.library.title")} tabIndex={-1}
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-2xl bg-panel shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h2 className="font-semibold text-ink">{t("skills.library.title")}</h2>
          <button type="button" onClick={close} aria-label={t("skills.library.close")} className="rounded-lg p-2 text-ink-secondary hover:bg-control"><X size={16} /></button>
        </div>
        <div className="min-h-0 overflow-auto px-3 pb-3"><SkillsSection chat={{ ...chat, use(name) { if (panel.current?.isConnected) chat.use(name); } }} /></div>
      </div>
    </div>
  );
}

export function ChatSkillLibrary({ botId, threadId, team, composer }: {
  botId: string; threadId: string; team: boolean; composer: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const admin = useOwnerOrAdmin();
  if (team && !admin) return null;
  return (
    <div className="shrink-0 px-3 py-1">
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-control px-3 py-2 text-[13px] font-medium text-ink hover:bg-raised-hover">
        <BookOpen size={15} aria-hidden="true" />{t("skills.library.title")}
      </button>
      {open && <Layer modal><ChatLibraryDialog close={() => setOpen(false)} chat={{ botId, threadId, use(name) {
        leadComposerDraft(`bot:${botId}:${threadId}`, `/${name} `);
        setOpen(false);
        requestAnimationFrame(() => composer.current?.querySelector("textarea")?.focus());
      } }} /></Layer>}
    </div>
  );
}
