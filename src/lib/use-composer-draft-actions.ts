import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Attachment } from "./composer-attachments.ts";
import { markDraftEdited } from "./drafts.ts";

export function useComposerDraftActions(draftId: string, setText: (value: string) => void, setAttachments: Dispatch<SetStateAction<Attachment[]>>) {
  const editText = useCallback(
    (next: string) => {
      markDraftEdited(draftId);
      setText(next);
    },
    [draftId, setText],
  );
  const editAttachments = useCallback(
    (next: SetStateAction<Attachment[]>) => {
      markDraftEdited(draftId);
      setAttachments(next);
    },
    [draftId, setAttachments],
  );
  return { editText, editAttachments };
}
