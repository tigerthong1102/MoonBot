import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef, PDFStream } from "pdf-lib";

const catalogKeys = new Set("Type Pages Version PageMode PageLayout PageLabels Lang Metadata MarkInfo StructTreeRoot ViewerPreferences".split(" "));
const activeKeys = new Set("AA OpenAction AcroForm XFA EmbeddedFiles EmbeddedFile EF AF AFRelationship JavaScript JS RichMediaContent RichMediaSettings Movie Sound Launch URI URL SubmitForm ImportData Rendition OPI Ref Collection NeedsRendering PA PresSteps".split(" "));
const actionTypes = new Set("GoTo GoToR GoToE GoTo3DView Launch Thread URI Sound Movie Hide Named SubmitForm ResetForm ImportData JavaScript SetOCGState Rendition Trans RichMediaExecute".split(" "));
const activeNames = new Set("Action JavaScript Launch URI GoToR GoToE SubmitForm ImportData Rendition RichMedia EmbeddedFile Filespec FileAttachment Movie Sound Screen 3D XFA PS PostScript".split(" "));

export async function passivePdf(bytes: Buffer): Promise<boolean> {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1"))) return false;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true });
  const objects = doc.context.enumerateIndirectObjects();
  if (!objects.length || objects.length > 20_000 || doc.catalog.keys().some(key => !catalogKeys.has(key.decodeText()))) return false;
  const seen = new Set<PDFObject>();
  const queue = objects.map(([, object]) => object);
  while (queue.length) {
    const object = queue.pop()!;
    if (seen.has(object) || object instanceof PDFRef) continue;
    if (seen.size >= 200_000) return false;
    seen.add(object);
    if (object instanceof PDFStream) {
      if (object.dict.has(PDFName.of("F")) || object.dict.has(PDFName.of("FFilter")) || object.dict.has(PDFName.of("FDecodeParms"))) return false;
      queue.push(object.dict);
    } else if (object instanceof PDFArray) {
      for (const item of object.asArray()) queue.push(item);
    } else if (object instanceof PDFDict) {
      for (const [name, value] of object.entries()) {
        const label = name.decodeText();
        if (activeKeys.has(label) || label === "FS") return false;
        if (label === "S") {
          const subtype = doc.context.lookup(value);
          if (subtype instanceof PDFName && actionTypes.has(subtype.decodeText())) return false;
        }
        if (label === "Annots") {
          const annots = doc.context.lookup(value);
          if (!(annots instanceof PDFArray) || annots.size() > 0) return false;
        }
        if (label === "A") {
          const attribute = doc.context.lookup(value);
          if (doc.context.lookup(object.get(PDFName.of("Type"))) !== PDFName.of("StructElem")) return false;
          const attributes = attribute instanceof PDFArray ? attribute.asArray() : [attribute];
          if (!attributes.every(item => {
            const entry = doc.context.lookup(item);
            return entry instanceof PDFDict && entry.has(PDFName.of("O")) && !entry.has(PDFName.of("S"));
          })) return false;
        }
        queue.push(value);
      }
    } else if (object instanceof PDFName && activeNames.has(object.decodeText())) return false;
  }
  const pages = doc.getPages();
  return pages.length > 0 && pages.length <= 500 && pages.every(page => {
    const { width, height } = page.getSize();
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  });
}
