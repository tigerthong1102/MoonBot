import { createHash } from "node:crypto";
import { z } from "zod";
import type { OpenedMessageFile } from "./message-file.ts";

export const SOURCE_FILE_MAX = 512 * 1024;
const request = z.object({ start: z.number().int().positive(), end: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const refusal = (status: number, message: string) => Object.assign(new Error(message), { status });

export async function readSourceLines(file: OpenedMessageFile, raw: unknown) {
  try {
    const range = request.safeParse(raw);
    if (!range.success || range.data.end < range.data.start || range.data.end - range.data.start >= 120) throw refusal(400, "Choose one to 120 consecutive lines.");
    const { start, end, sha256 } = range.data;
    if (file.bytes > SOURCE_FILE_MAX) throw refusal(413, "Choose a source file under 512 KiB.");
    const bytes = Buffer.alloc(file.bytes + 1);
    let used = 0;
    while (used < bytes.length) {
      const part = await file.handle.read(bytes, used, bytes.length - used, used);
      if (!part.bytesRead) break;
      used += part.bytesRead;
    }
    if (used !== file.bytes) throw refusal(409, "The file changed while reading. Select it again.");
    const data = bytes.subarray(0, used);
    const digest = createHash("sha256").update(data).digest("hex");
    if (sha256 && sha256 !== digest) throw refusal(409, "The file changed. Select the current revision again.");
    if (data.some(byte => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) throw refusal(415, "Choose a UTF-8 text file.");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { throw refusal(415, "Choose a UTF-8 text file."); }
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.at(-1) === "") lines.pop();
    if (end > lines.length) throw refusal(422, "The source contains " + lines.length + " lines.");
    const excerpt = lines.slice(start - 1, end).join("\n");
    if (Buffer.byteLength(excerpt) > 16 * 1024) throw refusal(413, "Select fewer source lines.");
    return { start, end, sha256: digest, text: excerpt };
  } finally { await file.handle.close(); }
}
