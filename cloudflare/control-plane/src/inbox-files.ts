import { z } from "zod";
import { HTTPError, json, readBoundedBody } from "./http";

const maxFileBytes = 1024 * 1024;
const canPost = `SELECT 1 FROM inbox_rooms r JOIN inbox_members m ON m.room=r.id
  WHERE r.id=? AND m.person=? AND m.state='active' AND
  (r.kind='group' OR (SELECT count(*) FROM inbox_members WHERE room=r.id AND state='active')=2)`;

export async function inboxFile(
  req: Request,
  db: D1Database,
  user: string,
  room: string,
  key: string,
  retention: number,
) {
  if (req.method === "GET" && /^[1-9]\d{0,15}$/.test(key)) {
    const row = await db
      .prepare(
        `SELECT f.name,f.bytes FROM inbox_files f
      JOIN inbox_members m ON m.room=f.room AND m.person=? AND m.state='active'
      WHERE f.room=? AND f.post=? AND f.post>m.after_seq AND f.created>=?`,
      )
      .bind(user, room, Number(key), Date.now() - retention)
      .first<{ name: string; bytes: ArrayBuffer | number[] }>();
    if (!row) throw new HTTPError(404, "unavailable");
    return new Response(new Uint8Array(row.bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition":
          "attachment; filename*=UTF-8''" +
          encodeURIComponent(row.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16)),
      },
    });
  }
  if (req.method !== "POST" || !z.uuid().safeParse(key).success) throw new HTTPError(404, "unavailable");
  if (!(await db.prepare(canPost).bind(room, user).first())) throw new HTTPError(404, "unavailable");
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
  const bytes = await readBoundedBody(req, maxFileBytes);
  if (!bytes.length) throw new HTTPError(400, "empty_file");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const now = Date.now();
  const [insert, existing] = await db.batch([
    db
      .prepare(
        `INSERT INTO inbox_files(room,author,nonce,name,digest,bytes,created)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (${canPost})
      AND NOT EXISTS (SELECT 1 FROM inbox_posts WHERE room=? AND author=? AND nonce=?)
      AND (SELECT count(*) FROM inbox_files WHERE author=? AND created>?)<20`,
      )
      .bind(
        room,
        user,
        key,
        name,
        digest,
        bytes.buffer,
        now,
        room,
        user,
        room,
        user,
        key,
        user,
        now - 86400_000,
      ),
    db
      .prepare(
        `SELECT post FROM inbox_files WHERE room=? AND author=? AND nonce=? AND digest=? AND name=? AND EXISTS (${canPost})`,
      )
      .bind(room, user, key, digest, name, room, user),
  ]);
  if (!existing.results.length) throw new HTTPError(409, "upload_unavailable");
  return json({ ok: true }, insert.meta.changes ? 201 : 200);
}
