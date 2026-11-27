import { randomUuid } from "@/lib/random-uuid";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { t } from "@/lib/i18n";
import { prependComposerDraft } from "@/lib/drafts";
import { uploadDraftImage } from "@/lib/composer-uploads";

type Result = { text: string; image: string | null };
export interface PickerHandle {
  receive(message: Readonly<Record<string, unknown>>): void;
}

export function ElementEvidencePicker({ ref, draftId, portable, pick, close }: {
  ref: Ref<PickerHandle>;
  draftId: string;
  portable: boolean;
  pick: (x: number, y: number, id: string) => boolean;
  close: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [phase, setPhase] = useState<"pick" | "waiting" | "review" | "failed" | "adding">("pick");
  const pending = useRef("");
  const adding = useRef(false);
  const surface = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState({ x: 50, y: 50 });
  useEffect(() => {
    if (phase === "pick") surface.current?.focus();
    if (phase === "review") addButton.current?.focus();
    if (phase === "failed") cancelButton.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = setTimeout(() => { pending.current = ""; setPhase("failed"); }, 12_000);
    return () => clearTimeout(timer);
  }, [phase]);
  useImperativeHandle(ref, () => ({
    receive(message) {
      if (!pending.current || message.requestId !== pending.current) return;
      pending.current = "";
      const evidence = message.evidence as Partial<Result> | null;
      if (!evidence || typeof evidence.text !== "string") { setPhase("failed"); return; }
      setResult({ text: evidence.text, image: typeof evidence.image === "string" ? evidence.image : null });
      setPhase("review");
    },
  }), []);
  async function add() {
    if (!result || adding.current) return;
    adding.current = true;
    setPhase("adding");
    try {
      if (result.image) {
        const bytes = Uint8Array.from(atob(result.image), c => c.charCodeAt(0));
        await uploadDraftImage(draftId, new File([bytes], "web-element.png", { type: "image/png" }), portable);
      }
      prependComposerDraft(draftId, result.text);
      close();
    } catch {
      setPhase("failed");
    } finally {
      adding.current = false;
    }
  }
  return <div className="absolute inset-0 z-20 flex flex-col items-start" onKeyDown={event => {
    if (event.key === "Escape" && !adding.current) { event.preventDefault(); close(); }
  }}>
    {phase === "pick" && <button ref={surface} type="button" aria-label={t("browser.evidence.pick")}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space" className="group absolute inset-0 cursor-crosshair touch-none"
      onKeyDown={event => {
        const delta = event.shiftKey ? 1 : 5;
        const moves: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        setCursor(point => ({ x: Math.max(0, Math.min(99.9, point.x + move[0])), y: Math.max(0, Math.min(99.9, point.y + move[1])) }));
      }} onClick={event => {
      const box = event.currentTarget.getBoundingClientRect();
      const x = event.detail === 0 ? box.left + box.width * cursor.x / 100 : event.clientX;
      const y = event.detail === 0 ? box.top + box.height * cursor.y / 100 : event.clientY;
      const id = randomUuid();
      pending.current = id;
      if (pick(x, y, id)) setPhase("waiting");
      else { pending.current = ""; setPhase("failed"); }
    }}>
      <span aria-hidden="true" className="pointer-events-none absolute hidden -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-card px-1 text-ink group-focus-visible:block"
        style={{ left: cursor.x + "%", top: cursor.y + "%" }}>+</span>
      <kbd aria-hidden="true" className="absolute bottom-2 left-2 hidden rounded bg-card px-2 text-ink group-focus-visible:block">← ↑ ↓ → · Enter</kbd>
    </button>}
    <div className="relative m-2 max-h-full max-w-full overflow-auto rounded-xl border border-hairline bg-card p-3 text-sm text-ink shadow-lg">
      <p role="status">{t(phase === "failed" ? "browser.evidence.failed" : phase === "waiting" || phase === "adding" ? "studio.working" : phase === "review" ? "browser.evidence.add" : "browser.evidence.pick")}</p>
      {phase === "review" && result && <>
        <pre className="my-2 max-w-80 whitespace-pre-wrap break-all text-xs">{result.text}</pre>
        {result.image && <img className="mb-2 max-w-full" src={`data:image/png;base64,${result.image}`} alt={t("browser.evidence.pick")} />}
        <button ref={addButton} type="button" className="ui-button ui-button-primary mr-3" onClick={add}>{t("browser.evidence.add")}</button>
      </>}
      <button ref={cancelButton} type="button" disabled={phase === "adding"} className="rounded-md px-2 py-1 hover:bg-inset" onClick={close}>{t("common.cancel")}</button>
    </div>
  </div>;
}
