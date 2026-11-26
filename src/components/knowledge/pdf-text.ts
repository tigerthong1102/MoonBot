import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export function openSourcePdf(bytes: ArrayBuffer) {
  GlobalWorkerOptions.workerSrc = workerUrl;
  return getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, useWasm: false, disableFontFace: true,
    isImageDecoderSupported: false, stopAtErrors: true });
}

export async function pdfText(bytes: ArrayBuffer) {
  const task = openSourcePdf(bytes);
  const pages: string[] = [];
  let length = 0;
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 500) throw new Error("page limit");
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      length += text.length;
      if (length > 4 * 1024 * 1024) throw new Error("text limit");
      pages.push(text);
      page.cleanup();
    }
    if (!length) throw new Error("PDF has no text");
    return pages.join("\f");
  } finally { await task.destroy(); }
}
