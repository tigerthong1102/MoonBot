import { useRef } from "react";
import { t } from "./i18n";
import type { Attachment } from "./composer-attachments.ts";
import { draftRevision, isDraftAttachmentPending } from "./drafts.ts";
import { fetchSourceLines, type SourceLineReference } from "./source-line-reference.ts";

export function useComposerSourceCheck(threadId: string, draftId: string, activeDraft: { current: string }, notice: (error: string) => void) {
  const busy = useRef(false);
  const verify = async (refs: SourceLineReference[]): Promise<string[] | null> => {
    if (busy.current) return null;
    if (refs.length > 8) { notice(t("composer.sourceLimit")); return null; }
    busy.current = true;
    const revision = draftRevision(draftId);
    try {
      const resolved = await Promise.all(refs.map(async ref => {
        const { text } = await fetchSourceLines(ref, threadId);
        return JSON.stringify({ file: ref.name, lines: [ref.start, ref.end], sha256: ref.sha256, excerpt: text });
      }));
      return activeDraft.current === draftId && draftRevision(draftId) === revision ? resolved : null;
    } catch (error) { if (activeDraft.current === draftId) notice(error instanceof Error ? error.message : String(error)); return null; }
    finally { busy.current = false; }
  };
  const prepare = async (attachments: Attachment[], refs: SourceLineReference[]): Promise<Attachment[] | null> => {
    const texts = await verify(refs);
    if (!texts || isDraftAttachmentPending(draftId)) return null;
    let index = 0;
    return attachments.map(a => a.kind === "paste" && a.resource ? { ...a, text: texts[index++]! } : a);
  };
  return { busy, verify, prepare };
}
