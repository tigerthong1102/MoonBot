import { pendingBotTurns, roomBots } from "./inbox-bots";
import { canPost } from "./inbox-files";
import { groupManager, joinGroup, moderate } from "./inbox-group";
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
  z.object({ kind: z.literal("direct"), id: z.uuid(), email, guest: guestOptions.optional(), instant: z.boolean().default(false) }),
  z.object({
    kind: z.literal("group"), id: z.uuid(), title: z.string().trim().min(1).max(80),
    invitees: z.array(email).max(8).default([]), guest: guestOptions.optional(),
  }),
]);
const maxPostLength = 8000;
export const maxPostBytes = 6 * maxPostLength + 1024;
const post = z.object({
  nonce: z.uuid(),
  kind: z.enum(["text", "skill", "task"]),
  body: z.string().trim().min(1).max(maxPostLength),
});
const invite = z.object({ email, guest: guestOptions.optional(), instant: z.boolean().default(false) });
const remove = z.object({ person: z.string().min(1).max(128) });
const pageSize = 50;
export const inboxRetention = 30 * 86400_000;

async function body<T>(req: Request, schema: z.ZodType<T>, maxBytes?: number) {
  const parsed = schema.safeParse(await readBoundedJSON(req, maxBytes));
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

function inviteGroupMember(db: D1Database, room: string, owner: string, address: string, instant: boolean) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO inbox_members(room,person,state,after_seq)
    SELECT room,person,state,CASE WHEN state='active' THEN coalesce((SELECT MAX(seq) FROM inbox_posts WHERE room=eligible.room),0) ELSE 0 END
    FROM (SELECT r.id AS room,u.id AS person,CASE WHEN ?4=1 AND r.membership_history_complete=1
      AND NOT EXISTS(SELECT 1 FROM inbox_group_departures WHERE room=r.id AND person=u.id)
      AND (SELECT count(*) FROM inbox_members WHERE person=u.id AND state='active')<200
      THEN 'active' ELSE 'pending' END AS state
    FROM inbox_rooms r JOIN "user" u ON u.email=?3
    WHERE u.emailVerified=1 AND u.id NOT IN (?2,r.owner) AND r.id=?1 AND r.kind='group' AND EXISTS (${groupManager})
    AND NOT EXISTS (SELECT 1 FROM inbox_blocks WHERE (person=u.id AND sender IN (r.owner,?2)) OR (sender=u.id AND person IN (r.owner,?2)))
    AND NOT EXISTS (SELECT 1 FROM inbox_group_bans WHERE room=r.id AND person=u.id)
    AND (SELECT count(*) FROM inbox_members WHERE room=r.id)+(SELECT count(*) FROM inbox_guest_invites WHERE room=r.id AND created>=?)<20
    ) eligible WHERE state='active' OR (SELECT count(*) FROM inbox_members WHERE person=eligible.person AND state='pending')<50`,
    )
    .bind(room, owner, address, Number(instant), Date.now() - 7 * 86400_000);
}

async function inviteToGroup(env: InboxEnv, ctx: ExecutionContext, user: string, room: string, addresses: string[], instant: boolean, guest?: z.infer<typeof guestOptions>) {
  if (!addresses.length) return;
  if (guest && redactSecretsInText(guest.note) !== guest.note) throw new HTTPError(400, "contains_secret");
  await env.DB.batch(addresses.map(address => inviteGroupMember(env.DB, room, user, address, instant)));
  if (guest) {
    for (const address of addresses) {
      if (await recordGuestInvite(env, user, room, address, guest)) {
        ctx.waitUntil(deliverGuestMail(env, room, address).catch(() => console.error("inbox invite delivery failed")));
      }
    }
  }
}

function changed(result: D1Result) {
  if (!result.meta.changes) throw new HTTPError(404, "unavailable");
  return json({ ok: true });
}

async function roomDetail(db: D1Database, user: string, room: string, before: number, now: number) {
  const [access, members, posts, requests, bans] = await db.batch<Row>([
    db.prepare(`SELECT r.owner,r.approval,r.announcements,CASE WHEN r.invite_until>?3 THEN r.invite_key END AS link
      FROM inbox_rooms r JOIN inbox_members m ON m.room=r.id WHERE r.id=?1 AND m.person=?2 AND m.state='active'`).bind(room,user,now),
    db
      .prepare(
        `SELECT u.id,u.email,m.admin,m.muted FROM inbox_members m JOIN "user" u ON u.id=m.person
      WHERE m.room=? AND m.state='active' AND EXISTS (${memberAccess}) ORDER BY u.email`,
      )
      .bind(room, room, user),
    db
      .prepare(
        `SELECT p.seq,CASE WHEN f.post IS NULL AND upload.post IS NULL THEN p.kind ELSE 'file' END AS kind,coalesce(upload.size,length(f.bytes)) AS fileSize,p.body,p.created,p.bot_name AS botName,u.email AS author FROM inbox_posts p LEFT JOIN inbox_files f ON f.post=p.seq
      LEFT JOIN inbox_uploads upload ON upload.post=p.seq
      JOIN inbox_members m ON m.room=p.room AND m.person=? AND m.state='active'
      JOIN "user" u ON u.id=p.author WHERE p.room=? AND p.seq>m.after_seq AND p.seq<? AND p.created>=?
      ORDER BY p.seq DESC LIMIT ?`,
      )
      .bind(user, room, before, now - inboxRetention, pageSize + 1),
    db.prepare(`SELECT u.id,u.email FROM inbox_group_requests q JOIN "user" u ON u.id=q.person
      JOIN inbox_rooms r ON r.id=q.room WHERE q.room=?1 AND r.invite_until>?3 AND EXISTS(${groupManager}) ORDER BY u.email`).bind(room,user,now),
    db.prepare(`SELECT u.id,u.email FROM inbox_group_bans b JOIN "user" u ON u.id=b.person
      WHERE b.room=?1 AND EXISTS(${groupManager}) ORDER BY u.email`).bind(room,user),
  ]);
  if (!access.results.length) return null;
  return {
    group: access.results[0], requests: requests.results, bans: bans.results,
    members: members.results,
    posts: posts.results.slice(0, pageSize).reverse(),
    more: posts.results.length > pageSize,
  };
}

export async function inboxRoutes(req: Request, env: InboxEnv, user: string, ctx: ExecutionContext) {
  const db = env.DB;
  const url = new URL(req.url);
  const skillDownload = /^\/api\/saved\/([0-9]{1,16})\/download$/.exec(url.pathname);
  if (skillDownload && req.method === "GET") {
    const seq = Number(skillDownload[1]);
    if (!Number.isSafeInteger(seq)) throw new HTTPError(404, "unavailable");
    const skill = await db.prepare("SELECT body FROM inbox_saved WHERE person=? AND source_seq=? AND kind='skill'")
      .bind(user, seq).first<string>("body");
    if (skill === null) throw new HTTPError(404, "unavailable");
    return new Response(skill, { headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": 'attachment; filename="SKILL.md"',
    } });
  }
  if (url.pathname === "/api/bot-turns" && req.method === "GET") return pendingBotTurns(db,user);
  const botRoom = /^\/api\/rooms\/([a-f0-9-]{36})\/bots$/.exec(url.pathname);
  if (botRoom) {
    if (req.method === "POST") {
      const input = await req.clone().json<{action?:string}>().catch(() => ({} as {action?:string}));
      if (input?.action === "start") await limit(db,user,"inbox_bot_discussions",8,86400_000);
    }
    return roomBots(req,db,botRoom[1],user);
  }
  if (url.pathname === "/api/join" && req.method === "POST") {
    await limit(db, user, "inbox_join", 60, 86400_000);
    return joinGroup(req,db,user);
  }
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
          `SELECT r.id,r.kind,r.title,m.state,m.after_seq AS afterSeq,CASE WHEN m.state='active' THEN r.revision ELSE 0 END AS revision,m.admin,m.muted,r.announcements,r.owner=? AS isOwner,
        last.seq AS lastSeq,substr(last.body,1,100) AS snippet,last.created AS lastAt,u.email AS inviter FROM inbox_members m JOIN inbox_rooms r ON r.id=m.room
        JOIN "user" u ON u.id=r.owner
        LEFT JOIN inbox_posts last ON last.seq=(SELECT p.seq FROM inbox_posts p
          WHERE m.state='active' AND p.room=r.id AND p.seq>m.after_seq AND p.created>=?
          ORDER BY p.seq DESC LIMIT 1)
        WHERE m.person=? ORDER BY coalesce(last.created,r.created) DESC,r.id`,
        )
        .bind(user, Date.now() - inboxRetention, user)
        .all<Row>();
      const open = url.searchParams.get("open");
      if (!open) return json({ rooms: rooms.results });
      const selected = rooms.results.find((r) => r.id === open && r.state === "active");
      if (!selected) return json({ rooms: rooms.results, detail: null });
      if (url.searchParams.get("latest") === String(selected.lastSeq ?? 0) && url.searchParams.get("revision") === String(selected.revision))
        return json({ rooms: rooms.results, unchanged: true });
      const detail = await roomDetail(db, user, open, Number.MAX_SAFE_INTEGER, Date.now());
      return json({ rooms: rooms.results, detail });
    }
    if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
    const input = await body(req, create);
    if (input.guest && redactSecretsInText(input.guest.note) !== input.guest.note)
      throw new HTTPError(400, "contains_secret");
    await limit(db, user, "inbox_create", 20, 86400_000);
    if (
      input.kind === "direct" &&
      (await db.prepare('SELECT 1 FROM "user" WHERE id=? AND email=?').bind(user, input.email).first())
    )
      throw new HTTPError(400, "invalid_request");
    const title = input.kind === "group" ? input.title : input.email;
    const direct = `SELECT r.id FROM inbox_rooms r JOIN inbox_members m ON m.room=r.id
      JOIN "user" owner ON owner.id=r.owner
      WHERE r.kind='direct' AND m.person=?1 AND
      ((r.owner=?1 AND r.title=?2) OR (r.owner!=?1 AND owner.email=?2))
      ORDER BY (SELECT count(*) FROM inbox_members WHERE room=r.id AND state='active') DESC,r.created,r.id LIMIT 1`;
    const insertRoom = db.prepare(`INSERT INTO inbox_rooms(id,kind,title,owner,created,membership_history_complete)
        SELECT ?3,?4,?2,?1,?5,?4='group' WHERE (SELECT count(*) FROM inbox_rooms WHERE owner=?1)<100
        AND (?4!='direct' OR NOT EXISTS (${direct})) ON CONFLICT DO NOTHING`)
      .bind(user, title, input.id, input.kind, Date.now());
    const findRoom = input.kind === "direct"
      ? db.prepare(direct).bind(user, title)
      : db.prepare("SELECT id FROM inbox_rooms WHERE id=? AND owner=? AND kind='group' AND title=?")
          .bind(input.id, user, title);
    const statements = [insertRoom, findRoom];
    if (input.kind === "direct" && input.instant) {
      statements.splice(1, 0, db.prepare(`UPDATE inbox_members AS m SET state='active'
        WHERE changes()=1 AND m.room=?1 AND m.state='pending' AND m.person=(SELECT id FROM "user" WHERE email=?2 AND emailVerified=1)
        AND (SELECT count(*) FROM inbox_members WHERE person=m.person AND state='active')<200
        AND NOT EXISTS(SELECT 1 FROM inbox_blocks WHERE (person=?3 AND sender=m.person) OR (person=m.person AND sender=?3))
        AND EXISTS(SELECT 1 FROM inbox_rooms WHERE id=?1 AND owner=?3 AND kind='direct' AND title=?2)`)
        .bind(input.id, input.email, user));
    }
    const results = await db.batch<{ id: string }>(statements);
    const created = results[0], existing = results.at(-1)!;
    const id = created.meta.changes ? input.id : existing.results[0]?.id;
    if (!id) throw new HTTPError(409, "room_limit_or_conflict");
    if (input.kind === "group") {
      await inviteToGroup(env, ctx, user, id, [...new Set(input.invitees)], true, input.guest);
    }
    if (input.kind === "direct" && input.guest) {
      if (await recordGuestInvite(env, user, id, input.email, input.guest))
        ctx.waitUntil(
          deliverGuestMail(env, id, input.email).catch(() =>
            console.error("inbox invite delivery failed"),
          ),
        );
    }
    return json({ id });
  }
  const match = /^\/api\/rooms\/([0-9a-f-]{36})(?:\/(invite|accept|leave|close|remove|block|posts|moderate))?$/.exec(
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
    const detail = await roomDetail(db, user, room, before.data, now);
    if (!detail) throw new HTTPError(404, "unavailable");
    return json(detail);
  }
  if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
  if (action === "moderate") {
    await limit(db,user,"inbox_moderate",60,60000);
    return moderate(req,db,room,user);
  }
  if (action === "invite") {
    const input = await body(req, invite);
    await limit(db, user, "inbox_invite", 40, 86400_000);
    if (
      !(await db
        .prepare(groupManager)
        .bind(room, user)
        .first())
    )
      throw new HTTPError(404, "unavailable");
    await inviteToGroup(env, ctx, user, room, [input.email], input.instant, input.guest);
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
    const input = await body(req, post, maxPostBytes);
    if (redactSecretsInText(input.body) !== input.body) throw new HTTPError(400, "contains_secret");
    await limit(db, user, "inbox_post", 60, 60000);
    const result = await db
      .prepare(
        `INSERT INTO inbox_posts(room,author,nonce,kind,body,created)
      SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (${canPost})
      ON CONFLICT(room,author,nonce) DO UPDATE SET nonce=excluded.nonce
      WHERE kind=excluded.kind AND body=excluded.body`,
      )
      .bind(room, user, input.nonce, input.kind, input.body, now)
      .run();
    return changed(result);
  }
  throw new HTTPError(404, "unavailable");
}
