import { z } from "zod";
import { redactSecretsInText } from "../../../shared/redact";
import { HTTPError, json, readBoundedJSON } from "./http";

import type { InboxEnv } from "./personal-inbox-worker";
import { guestOptions, recordGuestInvite, deliverGuestMail } from "./inbox-guest";

type Row = Record<string, string | number>;

const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const create = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), id: z.uuid(), email, guest: guestOptions.optional() }),
  z.object({ kind: z.literal("group"), id: z.uuid(), title: z.string().trim().min(1).max(80) }),
]);
const post = z.object({
  nonce: z.uuid(),
  kind: z.enum(["text", "skill", "task"]),
  body: z.string().trim().min(1).max(8000),
});
const invite = z.object({ email, guest: guestOptions.optional() });
const remove = z.object({ person: z.string().min(1).max(128) });
const pageSize = 50;
export const inboxRetention = 30 * 86400_000;

async function body<T>(req: Request, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await readBoundedJSON(req));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  return parsed.data;
}

async function limit(db: D1Database, user: string, action: string, max: number, window: number) {
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO control_action_rate_limits
    (user_id, action, window_started_at, attempts, updated_at) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(user_id, action) DO UPDATE SET
      attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts+1 END,
      window_started_at = CASE WHEN window_started_at <= ? THEN excluded.updated_at ELSE window_started_at END,
      updated_at = excluded.updated_at WHERE window_started_at <= ? OR attempts < ?`,
    )
    .bind(user, action, now, now, now - window, now - window, now - window, max)
    .run();
  if (!result.meta.changes) throw new HTTPError(429, "rate_limited");
}

const memberAccess = "SELECT 1 FROM inbox_members WHERE room=? AND person=? AND state='active'";
const ownerAccess = "SELECT 1 FROM inbox_rooms WHERE id=? AND owner=?";

function inviteMember(db: D1Database, room: string, owner: string, address: string, kind: string) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO inbox_members(room,person,state)
    SELECT r.id,u.id,'pending' FROM inbox_rooms r JOIN "user" u ON u.email=?
    WHERE u.emailVerified=1 AND u.id!=? AND r.id=? AND r.owner=? AND r.kind=?
    AND NOT EXISTS (SELECT 1 FROM inbox_blocks WHERE person=u.id AND sender=r.owner)
    AND (SELECT count(*) FROM inbox_members WHERE room=r.id)+(SELECT count(*) FROM inbox_guest_invites WHERE room=r.id AND created>=?)<20
    AND (SELECT count(*) FROM inbox_members WHERE person=u.id AND state='pending')<50`,
    )
    .bind(address, owner, room, owner, kind, Date.now() - 7 * 86400_000);
}

function changed(result: D1Result) {
  if (!result.meta.changes) throw new HTTPError(404, "unavailable");
  return json({ ok: true });
}

export async function inboxRoutes(req: Request, env: InboxEnv, user: string, ctx: ExecutionContext) {
  const db = env.DB;
  const url = new URL(req.url);
  if (url.pathname === "/api/blocks") {
    if (req.method === "GET") {
      const rows = await db
        .prepare(
          'SELECT u.id,u.email FROM inbox_blocks b JOIN "user" u ON u.id=b.sender WHERE b.person=? ORDER BY u.email',
        )
        .bind(user)
        .all<Row>();
      return json({ people: rows.results });
    }
    if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
    const input = await body(req, remove);
    return changed(
      await db.prepare("DELETE FROM inbox_blocks WHERE person=? AND sender=?").bind(user, input.person).run(),
    );
  }
  if (url.pathname === "/api/saved") {
    if (req.method === "GET") {
      const saved = await db
        .prepare(
          "SELECT source_seq AS seq,kind,body,done FROM inbox_saved WHERE person=? ORDER BY source_seq DESC",
        )
        .bind(user)
        .all<Row>();
      return json({ saved: saved.results });
    }
    if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
    const input = await body(
      req,
      z.object({ seq: z.number().int().positive(), action: z.enum(["save", "done", "delete"]) }),
    );
    if (input.action === "delete")
      return changed(
        await db
          .prepare("DELETE FROM inbox_saved WHERE person=? AND source_seq=?")
          .bind(user, input.seq)
          .run(),
      );
    if (input.action === "done")
      return changed(
        await db
          .prepare("UPDATE inbox_saved SET done=1 WHERE person=? AND source_seq=? AND kind='task'")
          .bind(user, input.seq)
          .run(),
      );
    return changed(
      await db
        .prepare(
          `INSERT INTO inbox_saved(person,source_seq,kind,body)
      SELECT ?,p.seq,p.kind,p.body FROM inbox_posts p JOIN inbox_members m ON m.room=p.room
      WHERE p.seq=? AND p.kind IN ('skill','task') AND m.person=? AND m.state='active'
      AND p.seq>m.after_seq AND p.created>=? AND
      ((SELECT count(*) FROM inbox_saved WHERE person=?)<200 OR EXISTS
        (SELECT 1 FROM inbox_saved WHERE person=? AND source_seq=p.seq))
      ON CONFLICT(person,source_seq) DO UPDATE SET source_seq=excluded.source_seq`,
        )
        .bind(user, input.seq, user, Date.now() - inboxRetention, user, user)
        .run(),
    );
  }
  if (url.pathname === "/api/rooms") {
    if (req.method === "GET") {
      const rooms = await db
        .prepare(
          `SELECT r.id,r.kind,r.title,m.state,r.owner=? AS isOwner,
        u.email AS inviter FROM inbox_members m JOIN inbox_rooms r ON r.id=m.room
        JOIN "user" u ON u.id=r.owner WHERE m.person=? ORDER BY r.created DESC,r.id`,
        )
        .bind(user, user)
        .all<Row>();
      return json({ rooms: rooms.results });
    }
    if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
    const input = await body(req, create);
    await limit(db, user, "inbox_create", 20, 86400_000);
    if (
      input.kind === "direct" &&
      (await db.prepare('SELECT 1 FROM "user" WHERE id=? AND email=?').bind(user, input.email).first())
    )
      throw new HTTPError(400, "invalid_request");
    const title = input.kind === "group" ? input.title : input.email;
    const created = await db
      .prepare(
        `INSERT INTO inbox_rooms(id,kind,title,owner,created)
      SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM inbox_rooms WHERE owner=?)<100 ON CONFLICT DO NOTHING`,
      )
      .bind(input.id, input.kind, title, user, Date.now(), user)
      .run();
    if (
      !created.meta.changes &&
      !(await db
        .prepare("SELECT 1 FROM inbox_rooms WHERE id=? AND owner=? AND kind=? AND title=?")
        .bind(input.id, user, input.kind, title)
        .first())
    )
      throw new HTTPError(409, "room_limit_or_conflict");
    if (input.kind === "direct" && input.guest) {
      if (await recordGuestInvite(env, user, input.id, input.email, input.guest))
        ctx.waitUntil(
          deliverGuestMail(env, input.id, input.email).catch(() =>
            console.error("inbox invite delivery failed"),
          ),
        );
    }
    return json({ id: input.id });
  }
  const match = /^\/api\/rooms\/([0-9a-f-]{36})(?:\/(invite|accept|leave|close|remove|block|posts))?$/.exec(
    url.pathname,
  );
  if (!match) throw new HTTPError(404, "unavailable");
  const [, room, action] = match;
  const now = Date.now();
  if (req.method === "GET" && !action) {
    const before = z.coerce
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .safeParse(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
    if (!before.success) throw new HTTPError(400, "invalid_request");
    const [access, members, posts] = await db.batch<Row>([
      db.prepare(memberAccess).bind(room, user),
      db
        .prepare(
          `SELECT u.id,u.email FROM inbox_members m JOIN "user" u ON u.id=m.person
        WHERE m.room=? AND m.state='active' AND EXISTS (${memberAccess}) ORDER BY u.email`,
        )
        .bind(room, room, user),
      db
        .prepare(
          `SELECT p.seq,CASE WHEN f.post IS NULL THEN p.kind ELSE 'file' END AS kind,p.body,p.created,u.email AS author FROM inbox_posts p LEFT JOIN inbox_files f ON f.post=p.seq
        JOIN inbox_members m ON m.room=p.room AND m.person=? AND m.state='active'
        JOIN "user" u ON u.id=p.author WHERE p.room=? AND p.seq>m.after_seq AND p.seq<? AND p.created>=?
        ORDER BY p.seq DESC LIMIT ?`,
        )
        .bind(user, room, before.data, now - inboxRetention, pageSize + 1),
    ]);
    if (!access.results.length) throw new HTTPError(404, "unavailable");
    return json({
      members: members.results,
      posts: posts.results.slice(0, pageSize).reverse(),
      more: posts.results.length > pageSize,
    });
  }
  if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
  if (action === "invite") {
    const input = await body(req, invite);
    await limit(db, user, "inbox_invite", 40, 86400_000);
    if (
      !(await db
        .prepare("SELECT 1 FROM inbox_rooms WHERE id=? AND owner=? AND kind='group'")
        .bind(room, user)
        .first())
    )
      throw new HTTPError(404, "unavailable");
    if (input.guest && (await recordGuestInvite(env, user, room, input.email, input.guest)))
      ctx.waitUntil(
        deliverGuestMail(env, room, input.email).catch(() => console.error("inbox invite delivery failed")),
      );
    await inviteMember(db, room, user, input.email, "group").run();
    return json({ ok: true });
  }
  if (action === "accept")
    return changed(
      await db
        .prepare(
          `UPDATE inbox_members SET state='active',
    after_seq=COALESCE((SELECT MAX(seq) FROM inbox_posts WHERE room=?),0)
    WHERE room=? AND person=? AND state='pending' AND (SELECT count(*) FROM inbox_members WHERE person=? AND state='active')<200`,
        )
        .bind(room, room, user, user)
        .run(),
    );
  if (action === "close")
    return changed(await db.prepare("DELETE FROM inbox_rooms WHERE id=? AND owner=?").bind(room, user).run());
  if (action === "block") {
    const [blocked] = await db.batch([
      db
        .prepare(
          `INSERT INTO inbox_blocks(person,sender)
        SELECT ?,CASE WHEN r.owner=? THEN peer.person ELSE r.owner END
        FROM inbox_rooms r JOIN inbox_members self ON self.room=r.id AND self.person=?
        LEFT JOIN inbox_members peer ON peer.room=r.id AND peer.person!=? AND peer.state='active'
        WHERE r.id=? AND (r.owner!=? OR (r.kind='direct' AND peer.person IS NOT NULL))
        LIMIT 1 ON CONFLICT(person,sender) DO UPDATE SET sender=excluded.sender`,
        )
        .bind(user, user, user, user, room, user),
      db
        .prepare(
          `DELETE FROM inbox_members WHERE room=? AND person=? AND EXISTS (
        SELECT 1 FROM inbox_rooms r JOIN inbox_blocks b ON b.sender=r.owner
        WHERE r.id=? AND b.person=?)`,
        )
        .bind(room, user, room, user),
    ]);
    return changed(blocked);
  }
  if (action === "leave")
    return changed(
      await db
        .prepare(`DELETE FROM inbox_members WHERE room=? AND person=? AND NOT EXISTS (${ownerAccess})`)
        .bind(room, user, room, user)
        .run(),
    );
  if (action === "remove") {
    const input = await body(req, remove);
    return changed(
      await db
        .prepare(
          `DELETE FROM inbox_members WHERE room=? AND person=? AND person!=?
      AND EXISTS (SELECT 1 FROM inbox_rooms WHERE id=? AND owner=? AND kind='group')`,
        )
        .bind(room, input.person, user, room, user)
        .run(),
    );
  }
  if (action === "posts") {
    const input = await body(req, post);
    if (redactSecretsInText(input.body) !== input.body) throw new HTTPError(400, "contains_secret");
    await limit(db, user, "inbox_post", 60, 60000);
    const result = await db
      .prepare(
        `INSERT INTO inbox_posts(room,author,nonce,kind,body,created)
      SELECT ?,?,?,?,?,? WHERE EXISTS (${memberAccess})
      AND EXISTS (SELECT 1 FROM inbox_rooms r WHERE r.id=? AND (r.kind='group' OR
        (SELECT count(*) FROM inbox_members WHERE room=r.id AND state='active')=2))
      ON CONFLICT(room,author,nonce) DO UPDATE SET nonce=excluded.nonce
      WHERE kind=excluded.kind AND body=excluded.body`,
      )
      .bind(room, user, input.nonce, input.kind, input.body, now, room, user, room)
      .run();
    return changed(result);
  }
  throw new HTTPError(404, "unavailable");
}
