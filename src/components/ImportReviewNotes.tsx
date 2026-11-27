import { useEffect, useRef, useState } from "react";
import { leadComposerDraft } from "@/lib/drafts";
import { t } from "@/lib/i18n";

export function parseReviewNotes(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const header = /^Review ([a-f0-9]{40})\nBase ([a-f0-9]{40})\n\n/u.exec(normalized);
  if (!header || !/^.+ · (LEFT|RIGHT) · [1-9]\d*\n[^\n]/mu.test(normalized.slice(header[0].length))) throw new Error("Choose exported review notes.");
  return normalized;
}

export function ImportReviewNotes({ draft }: { draft: string }) {
  const generation = useRef(0);
  const [status, setStatus] = useState<"ready" | "added" | "invalid">("ready");
  useEffect(() => () => { ++generation.current; }, [draft]);
  async function read(file?: File) {
    if (!file) return;
    const token = ++generation.current;
    try {
      if (file.size > 128 * 1024) throw new Error("Review notes exceed 128 KiB.");
      const text = parseReviewNotes(await file.text());
      if (token !== generation.current) return;
      leadComposerDraft(draft, text);
      setStatus("added");
    } catch { if (token === generation.current) setStatus("invalid"); }
  }
  return <div className="mt-3 rounded-xl bg-card p-3 text-sm">
    <label className="flex flex-wrap items-center gap-2">{t("review.notes.import")}
      <input type="file" accept=".md,text/markdown" onChange={event => { void read(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    {status !== "ready" && <p role="status">{t(status === "added" ? "review.notes.added" : "review.notes.invalid")}</p>}
  </div>;
}
