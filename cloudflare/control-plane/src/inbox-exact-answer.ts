import { z } from "zod";
import { exactGrantMessage, exactPostMessage } from "../../../electron/twin-exact-message.mjs";
import { redactSecretsInText } from "../../../shared/redact";
import { HTTPError, json, readBoundedJSON } from "./http";
import { limitInboxAction } from "./personal-inbox";

const uuid = z.uuid(),
  signature = z.string().regex(/^[a-f0-9]{128}$/);
const selected = z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9]{32}$/);
const scope = z.union([z.tuple([z.literal("*")]), z.array(selected).min(1).max(100)]);
const ref = z.strictObject({ owner: uuid, id: uuid });
const body = z.discriminatedUnion("action", [
  ref.extend({
    action: z.literal("offer"),
    pairing: uuid,
    lesson: uuid,
    question: z.string().trim().min(1).max(250),
    answer: z.string().trim().min(1).max(750),
    rooms: scope,
    expires: z.int(),
    signature,
  }),
  ref.extend({ action: z.literal("inspect") }),
  ref.extend({ action: z.literal("approve"), review: uuid, purpose: z.literal("one-exact-owner-lesson-v1") }),
  ref.extend({ action: z.literal("claim") }),
  ref.extend({ action: z.literal("finish"), source: z.int().positive(), nonce: uuid, signature }),
  ref.extend({ action: z.literal("revoke") }),
]);

const dbNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const paired = "JOIN inbox_twin_pairings k ON k.id=g.pairing AND k.owner=g.owner";
const eligible = `
  FROM inbox_exact_grants g ${paired}
  JOIN inbox_posts p ON p.body=g.question AND p.kind='text' AND p.bot_name IS NULL
  JOIN inbox_rooms room ON room.id=p.room
  JOIN inbox_members mine ON mine.room=p.room AND mine.person=g.owner AND mine.state='active'
  JOIN inbox_exact_seats seat ON seat.room=p.room AND seat.person=g.owner
  JOIN inbox_members sender ON sender.room=p.room AND sender.person=p.author AND sender.state='active' AND sender.after_seq<p.seq AND sender.muted=0
  JOIN "user" author ON author.id=p.author AND author.emailVerified=1
  WHERE g.owner=?1 AND g.id=?2 AND k.origin=?3 AND k.desktop_session=?4 AND k.inbox_session IS NOT NULL
    AND g.after_seq IS NOT NULL AND p.seq>g.after_seq AND p.seq>mine.after_seq AND p.author!=g.owner
    AND k.expires>${dbNow} AND g.expires>${dbNow} AND g.signatures<20
    AND NOT EXISTS(SELECT 1 FROM inbox_files f WHERE f.post=p.seq)
    AND NOT EXISTS(SELECT 1 FROM inbox_uploads u WHERE u.post=p.seq)
    AND EXISTS(SELECT 1 FROM json_each(g.rooms) WHERE value='*' OR value=(p.room||'.'||seat.stamp))
    AND NOT EXISTS(SELECT 1 FROM inbox_blocks b WHERE (b.person=p.author AND b.sender=g.owner) OR (b.person=g.owner AND b.sender=p.author))
    AND ((room.kind='group' AND mine.muted=0 AND (room.announcements=0 OR room.owner=g.owner OR mine.admin=1))
      OR (room.kind='direct' AND (SELECT count(*) FROM inbox_members WHERE room=p.room AND state='active')=2))
    AND NOT EXISTS(SELECT 1 FROM inbox_exact_receipts r WHERE r.owner=g.owner AND r.source=p.seq)`;
const unavailable = () => new HTTPError(409, "exact_reply_unavailable");
const raw = (s: string) => Uint8Array.from(s.match(/../g)!, (b) => Number.parseInt(b, 16));
async function verified(key: string, text: string, sig: string) {
  const imported = await crypto.subtle.importKey("raw", raw(key), "Ed25519", false, ["verify"]);
  return crypto.subtle.verify("Ed25519", imported, raw(sig), new TextEncoder().encode(text));
}
type Release = {
  id: string;
  pairing: string;
  lesson: string;
  question: string;
  answer: string;
  rooms: string;
  expires: number;
  after_seq: number | null;
  signatures: number;
};

export async function inboxExactAnswer(
  req: Request,
  db: D1Database,
  session: { id: string; owner: string },
  published: (room: string) => void,
) {
  const { owner } = session,
    origin = new URL(req.url).origin;
  if (req.method === "GET" && new URL(req.url).searchParams.get("rooms") === "1") {
    const rooms = await db
      .prepare(
        `SELECT r.id,r.kind,
      CASE WHEN r.kind='direct' THEN (SELECT u.email FROM inbox_members peer JOIN "user" u ON u.id=peer.person WHERE peer.room=r.id AND peer.person!=m.person AND peer.state='active' LIMIT 1) ELSE r.title END AS title,
      (r.id||'.'||seat.stamp) AS ref
      FROM inbox_members m JOIN inbox_rooms r ON r.id=m.room JOIN inbox_exact_seats seat ON seat.room=m.room AND seat.person=m.person
      WHERE m.person=? AND m.state='active' ORDER BY r.created,r.id`,
      )
      .bind(owner)
      .all<{ id: string; kind: string; title: string | null; ref: string }>();
    return json({ owner, rooms: rooms.results });
  }
  if (req.method === "GET") {
    const row = await db
      .prepare(
        `SELECT g.id,g.question,g.answer,g.rooms,g.expires,g.after_seq,g.signatures,
      k.inbox_session=?3 AS reviewer FROM inbox_exact_grants g ${paired}
      WHERE g.owner=?1 AND k.origin=?2 AND g.expires>${dbNow} AND k.expires>${dbNow}`,
      )
      .bind(owner, origin, session.id)
      .first<Release & { reviewer: number }>();
    return json({
      owner,
      now: Date.now(),
      grant: row
        ? {
            id: row.id,
            ...(row.reviewer && { question: row.question, answer: row.answer }),
            rooms: JSON.parse(row.rooms),
            expires: row.expires,
            enabled: row.after_seq !== null,
            count: row.signatures,
            reviewer: Boolean(row.reviewer),
          }
        : null,
    });
  }
  const input = body.safeParse(await readBoundedJSON(req, 12_000));
  if (!input.success) throw new HTTPError(400, "invalid_request");
  const a = input.data;
  if (a.owner !== owner) throw unavailable();
  if (a.action === "revoke") {
    const [, , , receipt] = await db.batch([
      db.prepare(`DELETE FROM inbox_exact_revoked WHERE owner=? AND expires<=${dbNow}`).bind(owner),
      db
        .prepare(
          `INSERT INTO inbox_exact_revoked(owner,id,expires)
        SELECT ?1,?2,${dbNow}+600000 WHERE EXISTS(SELECT 1 FROM inbox_exact_grants WHERE owner=?1 AND id=?2)
          OR (SELECT count(*) FROM inbox_exact_revoked WHERE owner=?1)<100
        ON CONFLICT(owner,id) DO NOTHING`,
        )
        .bind(owner, a.id),
      db
        .prepare(
          `DELETE FROM inbox_exact_grants WHERE owner=? AND id=? AND EXISTS(SELECT 1 FROM inbox_twin_pairings WHERE id=inbox_exact_grants.pairing AND origin=?)`,
        )
        .bind(owner, a.id, origin),
      db
        .prepare(
          "SELECT 1 FROM inbox_exact_revoked WHERE owner=?1 AND id=?2 AND NOT EXISTS(SELECT 1 FROM inbox_exact_grants WHERE owner=?1 AND id=?2)",
        )
        .bind(owner, a.id),
    ]);
    if (!receipt.results.length) throw new HTTPError(429, "rate_limited");
    return json({ id: a.id, revoked: true });
  }
  if (a.action === "offer") {
    await limitInboxAction(db, owner, "exact_reply_offer", 6, 600_000);
    const rooms = [...new Set(a.rooms)].sort();
    if (
      rooms.join() !== a.rooms.join() ||
      redactSecretsInText(a.question) !== a.question ||
      redactSecretsInText(a.answer) !== a.answer
    )
      throw unavailable();
    const k = await db
      .prepare(
        `SELECT public_key,twin,revision FROM inbox_twin_pairings WHERE owner=? AND id=? AND origin=? AND desktop_session=? AND inbox_session IS NOT NULL AND expires>${dbNow}`,
      )
      .bind(owner, a.pairing, origin, session.id)
      .first<{ public_key: string; twin: string; revision: number }>();
    if (!k || !(await verified(k.public_key, exactGrantMessage({ ...a, ...k, rooms, origin }), a.signature)))
      throw unavailable();
    const [, added] = await db.batch([
      db.prepare(`DELETE FROM inbox_exact_grants WHERE owner=? AND expires<=${dbNow}`).bind(owner),
      db
        .prepare(
          `INSERT INTO inbox_exact_grants(id,pairing,owner,lesson,question,answer,rooms,expires)
        SELECT ?1,k.id,k.owner,?6,?7,?8,?9,?10 FROM inbox_twin_pairings k
        WHERE k.id=?2 AND k.owner=?3 AND k.origin=?4 AND k.desktop_session=?5 AND k.inbox_session IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM inbox_exact_revoked WHERE owner=?3 AND id=?1)
          AND ?10>${dbNow} AND ?10<=MIN(k.expires,${dbNow}+600000)
          AND NOT EXISTS(SELECT 1 FROM json_each(?9) selected WHERE selected.value!='*' AND NOT EXISTS
            (SELECT 1 FROM inbox_members m JOIN inbox_exact_seats s ON s.room=m.room AND s.person=m.person WHERE m.person=k.owner AND (m.room||'.'||s.stamp)=selected.value AND m.state='active'))
        ON CONFLICT DO NOTHING`,
        )
        .bind(
          a.id,
          a.pairing,
          owner,
          origin,
          session.id,
          a.lesson,
          a.question,
          a.answer,
          JSON.stringify(rooms),
          a.expires,
        ),
    ]);
    if (!added.meta.changes) throw unavailable();
    return json({ id: a.id, offered: true }, 201);
  }
  if (a.action === "inspect") {
    const review = crypto.randomUUID();
    const updated = await db
      .prepare(
        `UPDATE inbox_exact_grants SET review_nonce=? WHERE id=? AND owner=? AND after_seq IS NULL AND expires>${dbNow}
      AND EXISTS(SELECT 1 FROM inbox_twin_pairings k WHERE k.id=inbox_exact_grants.pairing AND k.origin=? AND k.inbox_session=? AND k.expires>${dbNow})`,
      )
      .bind(review, a.id, owner, origin, session.id)
      .run();
    if (!updated.meta.changes) throw unavailable();
    return json({ id: a.id, review });
  }
  if (a.action === "approve") {
    const approved = await db
      .prepare(
        `UPDATE inbox_exact_grants SET review_nonce=NULL,after_seq=(SELECT coalesce(max(seq),0) FROM inbox_posts)
      WHERE id=? AND owner=? AND review_nonce=? AND after_seq IS NULL AND expires>${dbNow}
      AND EXISTS(SELECT 1 FROM inbox_twin_pairings k WHERE k.id=inbox_exact_grants.pairing AND k.origin=? AND k.inbox_session=? AND k.expires>${dbNow})
      AND NOT EXISTS(SELECT 1 FROM json_each(rooms) selected WHERE selected.value!='*' AND NOT EXISTS
        (SELECT 1 FROM inbox_members m JOIN inbox_exact_seats s ON s.room=m.room AND s.person=m.person WHERE (m.room||'.'||s.stamp)=selected.value AND m.person=inbox_exact_grants.owner AND m.state='active'))`,
      )
      .bind(a.id, owner, a.review, origin, session.id)
      .run();
    if (!approved.meta.changes) throw unavailable();
    return json({ id: a.id, enabled: true });
  }
  const args = [owner, a.id, origin, session.id];
  if (a.action === "claim") {
    await limitInboxAction(db, owner, "exact_reply_poll", 90, 60_000);
    const exists = await db
      .prepare(
        `SELECT 1 FROM inbox_exact_grants g ${paired} WHERE g.owner=? AND g.id=? AND k.origin=? AND k.desktop_session=? AND g.expires>${dbNow} AND k.expires>${dbNow} AND g.signatures<20`,
      )
      .bind(...args)
      .first();
    if (!exists) throw unavailable();
    const nonce = crypto.randomUUID();
    const [, found] = await db.batch<{ source: number; room: string; nonce: string; expires: number }>([
      db
        .prepare(
          `INSERT INTO inbox_exact_challenges(owner,source,grant_id,nonce,expires,attempts)
        SELECT g.owner,p.seq,g.id,?5,MIN(g.expires,k.expires,${dbNow}+4000),1 ${eligible}
          AND NOT EXISTS(SELECT 1 FROM inbox_exact_challenges c WHERE c.owner=g.owner AND c.source=p.seq AND (c.expires>${dbNow} OR c.attempts>=3))
          ORDER BY p.seq LIMIT 1
        ON CONFLICT(owner,source) DO UPDATE SET nonce=excluded.nonce,expires=excluded.expires,attempts=attempts+1
          WHERE grant_id=excluded.grant_id AND expires<=${dbNow} AND attempts<3`,
        )
        .bind(...args, nonce),
      db
        .prepare(
          "SELECT c.source,p.room,c.nonce,c.expires FROM inbox_exact_challenges c JOIN inbox_posts p ON p.seq=c.source WHERE c.owner=? AND c.grant_id=? AND c.nonce=?",
        )
        .bind(owner, a.id, nonce),
    ]);
    return json({ now: Date.now(), challenge: found.results[0] ?? null });
  }
  const row = await db
    .prepare(
      `SELECT k.public_key,g.pairing,c.source,p.room,c.nonce,c.expires FROM inbox_exact_grants g ${paired}
    JOIN inbox_exact_challenges c ON c.owner=g.owner AND c.grant_id=g.id JOIN inbox_posts p ON p.seq=c.source
    WHERE g.owner=? AND g.id=? AND k.origin=? AND k.desktop_session=? AND c.source=? AND c.nonce=?`,
    )
    .bind(...args, a.source, a.nonce)
    .first<{
      public_key: string;
      pairing: string;
      source: number;
      room: string;
      nonce: string;
      expires: number;
    }>();
  if (!row) throw unavailable();
  const signedMessage = exactPostMessage({ ...row, origin, owner, id: a.id });
  if (!(await verified(row.public_key, signedMessage, a.signature))) throw unavailable();
  const committed = () =>
    db
      .prepare("SELECT 1 FROM inbox_exact_receipts WHERE owner=? AND source=? AND grant_id=? AND nonce=?")
      .bind(owner, a.source, a.id, a.nonce)
      .first();
  if (await committed()) return json({ published: true, source: a.source });
  await limitInboxAction(db, owner, "inbox_post", 60, 60_000);
  const result = await db
    .prepare(
      `INSERT INTO inbox_exact_receipts(owner,source,grant_id,nonce,signed_message,public_key,signature)
    SELECT g.owner,p.seq,g.id,?6,?7,k.public_key,?8 ${eligible}
      AND p.seq=?5 AND NOT EXISTS(SELECT 1 FROM inbox_posts used WHERE used.room=p.room AND used.author=g.owner AND used.nonce=?6) AND EXISTS(SELECT 1 FROM inbox_exact_challenges c WHERE c.owner=g.owner AND c.source=p.seq AND c.grant_id=g.id AND c.nonce=?6 AND c.expires>${dbNow})
    ON CONFLICT DO NOTHING`,
    )
    .bind(...args, a.source, a.nonce, signedMessage, a.signature)
    .run();
  if (result.meta.changes) published(row.room);
  else if (!(await committed())) throw unavailable();
  return json({ published: true, source: a.source });
}
