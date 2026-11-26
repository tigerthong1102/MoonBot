import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
import { t } from "@/lib/i18n";

function PdfPage({ pdf, number, label }: { pdf: PDFDocumentProxy; number: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let active = true;
    let render: RenderTask | undefined;
    const target = canvas.current!;
    void pdf.getPage(number).then(async page => {
      if (!active) return;
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(size.width, size.height)) });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      render = page.render({ canvas: target, viewport });
      try { await render.promise; } finally { page.cleanup(); }
      if (active) setState("ready");
    }).catch(() => { if (active) setState("failed"); });
    return () => { active = false; render?.cancel(); };
  }, [pdf, number]);
  return <>
    {state !== "ready" && <p role={state === "failed" ? "alert" : "status"}>{t(state === "failed" ? "knowledge.errorFile" : "knowledge.reading")}</p>}
    <canvas ref={canvas} role="img" aria-label={label} hidden={state !== "ready"} className="h-auto max-w-full" />
  </>;
}

function LocalPdfViewer({ file, path, initialPage, close }: { file: File; path: string; initialPage: number; close(): void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [number, setNumber] = useState(initialPage);
  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    void Promise.all([import("./pdf-text"), file.arrayBuffer()]).then(async ([{ openSourcePdf }, bytes]) => {
      if (!active) return;
      task = openSourcePdf(bytes);
      const document = await task.promise;
      if (initialPage > document.numPages) throw new Error("Missing page");
      if (active) setPdf(document);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; void task?.destroy().catch(() => {}); };
  }, [file, initialPage]);
  const label = pdf ? `${path} · ${number} / ${pdf.numPages}` : path;
  return <section aria-label={path} className="my-2 space-y-2">
    <div className="flex flex-wrap items-center gap-2"><output className="min-w-0 flex-1 break-all">{label}</output>
      {pdf && <><button type="button" className="ui-button ui-button-sm" disabled={number <= 1} onClick={() => setNumber(number - 1)}>{t("reconcile.review.previous")}</button>
        <button type="button" className="ui-button ui-button-sm" disabled={number >= pdf.numPages} onClick={() => setNumber(number + 1)}>{t("reconcile.review.next")}</button></>}
      <button type="button" className="ui-button ui-button-sm" onClick={close}>{t("reconcile.close")}</button>
    </div>
    {pdf ? <PdfPage key={number} pdf={pdf} number={number} label={label} /> :
      <p role={failed ? "alert" : "status"}>{t(failed ? "knowledge.errorFile" : "knowledge.reading")}</p>}
  </section>;
}

export function SourcePdf({ file, path, page }: { file: File; path: string; page: number }) {
  const desktop = Boolean(window.ogb);
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (desktop) return;
    const blob = URL.createObjectURL(file.slice(0, file.size, "application/pdf"));
    setUrl(blob);
    return () => URL.revokeObjectURL(blob);
  }, [desktop, file]);
  if (!desktop) return url && <a className="text-accent-text hover:underline" target="_blank" rel="noopener noreferrer"
    href={url + "#page=" + page}>{t("knowledge.openPdf")}</a>;
  return open ? <LocalPdfViewer file={file} path={path} initialPage={page} close={() => setOpen(false)} /> :
    <button type="button" className="text-accent-text hover:underline" onClick={() => setOpen(true)}>{t("knowledge.openPdf")}</button>;
}
