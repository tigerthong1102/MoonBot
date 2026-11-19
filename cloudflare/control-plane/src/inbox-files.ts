import { Buffer } from "node:buffer";
import { brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { HTTPError, json, readBoundedBody, readBoundedJSON } from "./http";

export const maxFileBytes = 50_000_000;
const singleRequestBytes = 20_000_000;
export const maxBatchParts = 8;
const dailyBytes = 60_000_000;
const retainedBytes = 180_000_000;
// Base64 keeps each D1 binding below the row limit without expanding a binary binding to a JSON array.
export const partBytes = 750_000;
const canPost = `SELECT 1 FROM inbox_rooms r JOIN inbox_members m ON m.room=r.id
  WHERE r.id=?1 AND m.person=?2 AND m.state='active' AND
  (r.kind='group' OR (SELECT count(*) FROM inbox_members WHERE room=r.id AND state='active')=2)`;

function rasterType(bytes: Uint8Array) {
  const magic = Array.from(bytes.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
  if (magic.startsWith("89504e470d0a1a0a")) return "image/png";
  if (magic.startsWith("ffd8ff")) return "image/jpeg";
  if (magic.startsWith("474946383761") || magic.startsWith("474946383961")) return "image/gif";
  if (/^52494646.{8}57454250$/.test(magic)) return "image/webp";
  return null;
}

const downloadPage = 3;

function decodePart(data: string) {
  if (!data.startsWith("gz:")) return Buffer.from(data, "base64");
  return gunzipSync(Buffer.from(data.slice(3), "base64"), { maxOutputLength: partBytes });
}

async function readParts(db: D1Database, upload: string, start: number, count: number) {
  const { results } = await db.prepare(
    "SELECT part,data FROM inbox_upload_parts WHERE upload=? AND part>=? ORDER BY part LIMIT ?",
  ).bind(upload, start, count).all<{ part: number; data: string }>();
  if (results.length !== count || results.some((r, i) => r.part !== start + i))
    throw new HTTPError(500, "incomplete_file");
  return results;
}

function unpackUpload(wire: Uint8Array<ArrayBuffer>, limit = singleRequestBytes, brotli = false) {
  let bytes;
  try {
    // workerd can require a complete output buffer at the end of a valid compressed stream.
    const maxOutputLength = Math.ceil((limit + 1) / 65536) * 65536;
    bytes = (brotli ? brotliDecompressSync : gunzipSync)(wire, { maxOutputLength });
  } catch (error) {
    if (error instanceof RangeError || (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE"))
      throw new HTTPError(413, "request_too_large");
    throw new HTTPError(400, "invalid_file_encoding");
  }
  if (bytes.length > limit) throw new HTTPError(413, "request_too_large");
  return bytes;
}

function fileName(req: Request) {
  let name: string;
  try {
    name = decodeURIComponent(req.headers.get("x-inbox-name") ?? "")
      .normalize("NFC")
      .trim();
  } catch {
    throw new HTTPError(400, "invalid_filename");
  }
  if (
    !name ||
    name.length > 180 ||
    /[\\/<>:"|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name) ||
    /^[. ]|[. ]$/.test(name)
  )
    throw new HTTPError(400, "invalid_filename");
  return name;
}

async function reserveUpload(db: D1Database, room: string, user: string, key: string, name: string, digest: string, size: number) {
  const now = Date.now();
  const since = now - 86400_000;
  const [insert, result] = await db.batch<{id: string; post: number | null}>([
    db.prepare(`INSERT INTO inbox_uploads(id,room,author,nonce,name,digest,size,created)
      SELECT ?8,?1,?2,?3,?4,?5,?6,?7
      FROM (SELECT max(?9, coalesce((SELECT reset_at FROM inbox_upload_allowance WHERE person=?2), 0)) AS since)
      WHERE EXISTS (${canPost})
      AND NOT EXISTS (SELECT 1 FROM inbox_posts WHERE room=?1 AND author=?2 AND nonce=?3)
      AND (SELECT count(*) FROM inbox_files WHERE author=?2 AND created>since) +
          (SELECT count(*) FROM inbox_uploads WHERE author=?2 AND created>since) < 20
      AND (SELECT coalesce(sum(length(bytes)),0) FROM inbox_files WHERE author=?2 AND created>since) +
          (SELECT coalesce(sum(size),0) FROM inbox_uploads WHERE author=?2 AND created>since) + ?6 <= ?10
      AND (SELECT coalesce(sum(length(bytes)),0) FROM inbox_files) +
          (SELECT coalesce(sum(size),0) FROM inbox_uploads) + ?6 <= ?11
      ON CONFLICT(room,author,nonce) DO NOTHING`)
      .bind(room, user, key, name, digest, size, now, crypto.randomUUID(), since, dailyBytes, retainedBytes),
    db.prepare(`SELECT id,post FROM inbox_uploads WHERE room=?1 AND author=?2 AND nonce=?3 AND name=?4 AND digest=?5
      AND EXISTS (${canPost})`).bind(room, user, key, name, digest),
  ]);
  const entry = result.results[0];
  if (!entry) throw new HTTPError(409, "upload_unavailable");
  return { id: entry.id, published: Boolean(entry.post), created: Boolean(insert.meta.changes) };
}

async function publishUpload(db: D1Database, room: string, user: string, key: string, upload: string, count: number) {
  const [, published] = await db.batch([
    db.prepare(`UPDATE inbox_uploads SET ready=1 WHERE id=?3 AND ready=0 AND EXISTS (${canPost})
      AND (SELECT count(*) FROM inbox_upload_parts WHERE upload=?3)=?4
      AND NOT EXISTS (SELECT 1 FROM inbox_posts WHERE room=?1 AND author=?2 AND nonce=?5)`)
      .bind(room, user, upload, count, key),
    db.prepare(`SELECT post FROM inbox_uploads WHERE id=?3 AND post IS NOT NULL AND EXISTS (${canPost})`)
      .bind(room, user, upload),
  ]);
  if (!published.results.length) throw new HTTPError(409, "upload_unavailable");
}

const manifestSchema = z.object({
  size: z.number().int().positive().max(maxFileBytes),
  hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(Math.ceil(maxFileBytes / partBytes)),
});

export async function inboxFilePart(req: Request, db: D1Database, user: string, room: string, nonce: string, action: string) {
  if (req.method !== "POST" || !z.uuid().safeParse(nonce).success) throw new HTTPError(405, "method_not_allowed");
  if (action === "start") {
    const manifest = manifestSchema.safeParse(await readBoundedJSON(req));
    if (!manifest.success || manifest.data.hashes.length !== Math.ceil(manifest.data.size / partBytes))
      throw new HTTPError(400, "invalid_request");
    const { size, hashes } = manifest.data;
    const entry = await reserveUpload(db, room, user, nonce, fileName(req), "parts:" + hashes.join(","), size);
    const stored = await db.prepare("SELECT part FROM inbox_upload_parts WHERE upload=? ORDER BY part")
      .bind(entry.id).all<{part: number}>();
    return json({ published: entry.published, received: stored.results.map((r) => r.part) });
  }
  const entry = await db.prepare(`SELECT id,digest,size,post FROM inbox_uploads
    WHERE room=?1 AND author=?2 AND nonce=?3 AND EXISTS (${canPost})`)
    .bind(room, user, nonce).first<{id: string; digest: string; size: number; post: number | null}>();
  if (!entry || !entry.digest.startsWith("parts:")) throw new HTTPError(404, "unavailable");
  const hashes = entry.digest.slice(6).split(",");
  if (action === "complete") {
    const started = Date.now();
    await publishUpload(db, room, user, nonce, entry.id, hashes.length);
    const result = json({ ok: true });
    result.headers.set("server-timing", "store;dur=" + (Date.now() - started));
    return result;
  }
  const part = Number(action);
  if (!Number.isInteger(part) || part < 0 || part >= hashes.length) throw new HTTPError(400, "invalid_request");
  const count = Number(req.headers.get("x-inbox-parts") ?? 1);
  const encoding = req.headers.get("x-inbox-encoding") ?? "identity";
  if (!["gzip", "br", "identity"].includes(encoding)) throw new HTTPError(400, "invalid_file_encoding");
  const packed = encoding !== "identity";
  if (!Number.isInteger(count) || count < 1 || count > maxBatchParts || part + count > hashes.length || (count > 1 && !packed))
    throw new HTTPError(400, "invalid_request");
  const length = Math.min(count * partBytes, entry.size - part * partBytes);
  const wire = await readBoundedBody(req, Math.min(partBytes, length));
  const bytes = packed ? unpackUpload(wire, length, encoding === "br") : wire;
  if (bytes.length !== length) throw new HTTPError(400, "invalid_part");
  const inserts = [];
  for (let i = 0; i < count; i++) {
    const raw = bytes.subarray(i * partBytes, (i + 1) * partBytes);
    if (await sha256(raw) !== hashes[part + i]) throw new HTTPError(400, "invalid_part");
    if (entry.post) continue;
    const compressed = packed ? (count === 1 && encoding === "gzip" ? wire : gzipSync(raw, { level: 1 })) : null;
    const data = compressed && compressed.length < raw.length
      ? "gz:" + Buffer.from(compressed).toString("base64") : Buffer.from(raw).toString("base64");
    inserts.push(db.prepare(`INSERT INTO inbox_upload_parts(upload,part,data)
      SELECT id,?4,?5 FROM inbox_uploads WHERE id=?3 AND ready=0 AND EXISTS (${canPost})
      ON CONFLICT(upload,part) DO NOTHING`).bind(room, user, entry.id, part + i, data));
  }
  if (inserts.length) await db.batch(inserts);
  return json({ ok: true });
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

export async function inboxFile(
  req: Request,
  db: D1Database,
  user: string,
  room: string,
  key: string,
  retention: number,
  compressed = false,
) {
  if (req.method === "GET" && /^[1-9]\d{0,15}$/.test(key)) {
    const access = `JOIN inbox_members m ON m.room=f.room AND m.person=? AND m.state='active'
      WHERE f.room=? AND f.post=? AND f.post>m.after_seq AND f.created>=?`;
    const params = [user, room, Number(key), Date.now() - retention];
    const row = await db.prepare(
      `SELECT f.id,f.size,f.name,NULL AS bytes FROM inbox_uploads f ${access}
       UNION ALL SELECT NULL,length(f.bytes),f.name,f.bytes FROM inbox_files f ${access}`,
    ).bind(...params, ...params).first<{id: string | null; size: number; name: string; bytes: number[]}>();
    if (!row) throw new HTTPError(404, "unavailable");
    const upload = row.id;
    const count = Math.ceil(row.size / partBytes);
    const firstPage = upload ? await readParts(db, upload, 0, Math.min(count, downloadPage)) : [];
    const first = upload ? decodePart(firstPage[0]!.data) : new Uint8Array(row.bytes);
    const headers = new Headers({ "content-type": "application/octet-stream" });
    if (new URL(req.url).searchParams.get("preview") === "1") {
      const type = rasterType(first);
      if (!type) throw new HTTPError(415, "unavailable");
      headers.set("content-type", type);
    } else {
      headers.set("content-disposition", "attachment; filename*=UTF-8''" +
        encodeURIComponent(row.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16)));
    }
    const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(req.headers.get("accept-encoding") ?? "");
    const compressedDownload = firstPage[0]?.data.startsWith("gz:") && acceptsGzip;
    if (!upload || (count === 1 && !compressedDownload)) return new Response(first, { headers });
    let next = firstPage.length;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        for (const r of firstPage.slice(1)) controller.enqueue(decodePart(r.data));
        if (next === count) controller.close();
      },
      async pull(controller) {
        const page = await readParts(db, upload, next, Math.min(downloadPage, count - next));
        for (const r of page) controller.enqueue(decodePart(r.data));
        next += page.length;
        if (next === count) controller.close();
      },
    });
    if (compressedDownload) {
      headers.set("content-encoding", "gzip");
      headers.set("vary", "Accept-Encoding");
    }
    return new Response(stream, { headers });
  }
  if (req.method !== "POST" || !z.uuid().safeParse(key).success) throw new HTTPError(404, "unavailable");
  if (!(await db.prepare(canPost).bind(room, user).first())) throw new HTTPError(404, "unavailable");
  const name = fileName(req);
  const wire = await readBoundedBody(req, singleRequestBytes);
  const receivedAt = Date.now();
  const bytes = compressed ? unpackUpload(wire) : wire;
  if (!bytes.length) throw new HTTPError(400, "empty_file");
  const digest = await sha256(bytes);
  const old = await db.prepare("SELECT digest,name FROM inbox_files WHERE room=? AND author=? AND nonce=?")
    .bind(room, user, key).first<{digest: string; name: string}>();
  if (old) {
    if (old.digest === digest && old.name === name) return json({ ok: true });
    throw new HTTPError(409, "upload_unavailable");
  }
  const entry = await reserveUpload(db, room, user, key, name, digest, bytes.length);
  if (entry.published) return json({ ok: true });
  const count = Math.ceil(bytes.length / partBytes);
  let batch: D1PreparedStatement[] = [];
  let batchChars = 0;
  for (let part = 0; part < count; part++) {
    const offset = part * partBytes;
    const raw = Buffer.from(bytes.buffer, bytes.byteOffset + offset, Math.min(partBytes, bytes.length - offset));
    const packed = compressed ? gzipSync(raw, { level: 1 }) : null;
    const data = packed && packed.length < raw.length * 0.95
      ? "gz:" + packed.toString("base64")
      : raw.toString("base64");
    batch.push(db.prepare(`INSERT INTO inbox_upload_parts(upload,part,data)
      SELECT id,?,? FROM inbox_uploads WHERE id=? AND ready=0
      ON CONFLICT(upload,part) DO NOTHING`).bind(part, data, entry.id));
    batchChars += data.length;
    if (batchChars >= 2_000_000 || part + 1 === count) {
      await db.batch(batch);
      batch = [];
      batchChars = 0;
    }
  }
  await publishUpload(db, room, user, key, entry.id, count);
  const response = json({ ok: true }, entry.created ? 201 : 200);
  response.headers.set("server-timing", "store;dur=" + (Date.now() - receivedAt));
  return response;
}
