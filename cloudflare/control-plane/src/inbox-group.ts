import { z } from "zod";
import { HTTPError, json, readBoundedJSON } from "./http";

export const groupManager = `SELECT 1 FROM inbox_rooms r JOIN inbox_members actor ON actor.room=r.id
  WHERE r.id=?1 AND actor.person=?2 AND r.kind='group' AND actor.state='active' AND (r.owner=?2 OR actor.admin=1)`;
const owner = "SELECT 1 FROM inbox_rooms WHERE id=?1 AND owner=?2 AND kind='group'";
const target = `room=?1 AND person=?3 AND person!=?2 AND state='active' AND EXISTS
  (SELECT 1 FROM inbox_rooms r WHERE r.id=?1 AND r.owner!=?3 AND (r.owner=?2 OR inbox_members.admin=0))`;
const roomCapacity = `(SELECT count(*) FROM inbox_members WHERE room=r.id) +
  (SELECT count(*) FROM inbox_guest_invites WHERE room=r.id AND created>=?4)<20`;
const canJoin = `NOT EXISTS(SELECT 1 FROM inbox_group_bans WHERE room=r.id AND person=?2)
  AND NOT EXISTS(SELECT 1 FROM inbox_blocks WHERE person=?2 AND sender=r.owner)
  AND (SELECT count(*) FROM inbox_members WHERE person=?2 AND state='active')<200`;
const boundary = "coalesce((SELECT max(seq) FROM inbox_posts WHERE room=r.id),0)";
const person = z.string().min(1).max(128);
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.enum([
      "promote",
      "demote",
      "mute",
      "unmute",
      "remove",
      "ban",
      "unban",
      "transfer",
      "approve",
      "deny",
    ]),
    person,
  }),
  z.object({ action: z.literal("deletePost"), seq: z.number().int().positive() }),
  z.object({ action: z.literal("cancelInvite"), email: z.email().max(254) }),
  z.object({ action: z.literal("rename"), title: z.string().trim().min(1).max(80) }),
  z.object({ action: z.enum(["approval", "announcements"]), enabled: z.boolean() }),
  z.object({ action: z.enum(["newLink", "revokeLink"]) }),
]);
const week = 7 * 86400_000;
function changed(r: D1Result) {
  if (!r.meta.changes) throw new HTTPError(404, "unavailable");
  return json({ ok: true });
}

export async function previewGroup(req: Request, db: D1Database) {
  const input = z.object({ token: z.uuid() }).safeParse(await readBoundedJSON(req));
  if (!input.success) throw new HTTPError(400, "invalid_request");
  const group = await db
    .prepare("SELECT title,approval FROM inbox_rooms WHERE invite_key=? AND invite_until>? AND kind='group'")
    .bind(input.data.token, Date.now())
    .first<{ title: string; approval: number }>();
  if (!group) throw new HTTPError(404, "unavailable");
  return json(group);
}

export async function joinGroup(req: Request, db: D1Database, user: string) {
  const input = z.object({ token: z.uuid() }).safeParse(await readBoundedJSON(req));
  if (!input.success) throw new HTTPError(400, "invalid_request");
  const now = Date.now(),
    args = [input.data.token, user, now, now - week];
  const valid = `r.kind='group' AND r.invite_key=?1 AND r.invite_until>?3 AND ${canJoin} AND ${roomCapacity}
    AND NOT EXISTS(SELECT 1 FROM inbox_members WHERE room=r.id AND person=?2)`;
  const [, , state] = await db.batch<{ id: string; state: string }>([
    db
      .prepare(
        `INSERT OR IGNORE INTO inbox_members(room,person,state,after_seq)
      SELECT r.id,?2,'active',${boundary} FROM inbox_rooms r WHERE ${valid} AND approval=0`,
      )
      .bind(...args),
    db
      .prepare(
        `INSERT OR IGNORE INTO inbox_group_requests(room,person)
      SELECT r.id,?2 FROM inbox_rooms r WHERE ${valid} AND approval=1
      AND (SELECT count(*) FROM inbox_group_requests WHERE room=r.id)<50
      AND (SELECT count(*) FROM inbox_group_requests WHERE person=?2)<50`,
      )
      .bind(...args),
    db
      .prepare(
        `SELECT r.id,coalesce(m.state,'requested') AS state FROM inbox_rooms r
      LEFT JOIN inbox_members m ON m.room=r.id AND m.person=?2
      WHERE r.invite_key=?1 AND r.invite_until>?3 AND (m.person IS NOT NULL OR EXISTS
      (SELECT 1 FROM inbox_group_requests WHERE room=r.id AND person=?2))`,
      )
      .bind(...args.slice(0, 3)),
  ]);
  if (!state.results[0]) throw new HTTPError(404, "unavailable");
  return json(state.results[0]);
}

export async function moderate(req: Request, db: D1Database, room: string, user: string) {
  const parsed = command.safeParse(await readBoundedJSON(req));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const cmd = parsed.data,
    args = [room, user];
  const manager = `EXISTS (${groupManager})`;
  if (cmd.action === "cancelInvite") {
    const [allowed] = await db.batch([
      db.prepare(groupManager).bind(room, user),
      db
        .prepare(
          `DELETE FROM inbox_members WHERE room=?1 AND state='pending'
        AND person=(SELECT id FROM "user" WHERE email=?3) AND ${manager}`,
        )
        .bind(room, user, cmd.email.toLowerCase()),
      db
        .prepare(`DELETE FROM inbox_guest_invites WHERE room=?1 AND email=?3 AND ${manager}`)
        .bind(room, user, cmd.email.toLowerCase()),
    ]);
    if (!allowed.results.length) throw new HTTPError(404, "unavailable");
    return json({ ok: true });
  }
  if (cmd.action === "deletePost")
    return changed(
      await db
        .prepare(
          `DELETE FROM inbox_posts WHERE room=?1 AND seq=?3 AND EXISTS
      (SELECT 1 FROM inbox_members m JOIN inbox_rooms r ON r.id=m.room WHERE m.room=?1 AND m.person=?2
      AND r.kind='group' AND m.state='active' AND inbox_posts.seq>m.after_seq
      AND (inbox_posts.author=?2 OR r.owner=?2 OR (m.admin=1 AND inbox_posts.author!=r.owner
      AND NOT EXISTS(SELECT 1 FROM inbox_members p WHERE p.room=r.id AND p.person=inbox_posts.author AND p.admin=1))))`,
        )
        .bind(...args, cmd.seq)
        .run(),
    );
  if (cmd.action === "rename")
    return changed(
      await db
        .prepare(`UPDATE inbox_rooms SET title=?3,revision=revision+1 WHERE id=?1 AND ${manager}`)
        .bind(...args, cmd.title)
        .run(),
    );
  if (cmd.action === "approval" || cmd.action === "announcements")
    return changed(
      await db
        .prepare(`UPDATE inbox_rooms SET ${cmd.action}=?3,revision=revision+1 WHERE id=?1 AND ${manager}`)
        .bind(...args, Number(cmd.enabled))
        .run(),
    );
  if (cmd.action === "newLink" || cmd.action === "revokeLink")
    return changed(
      await db
        .prepare(
          `UPDATE inbox_rooms SET invite_key=?3,invite_until=?4,revision=revision+1 WHERE id=?1 AND ${manager}`,
        )
        .bind(
          ...args,
          cmd.action === "newLink" ? crypto.randomUUID() : null,
          cmd.action === "newLink" ? Date.now() + week : 0,
        )
        .run(),
    );
  if (!("person" in cmd)) throw new HTTPError(400, "invalid_request");
  args.push(cmd.person);
  switch (cmd.action) {
    case "promote":
    case "demote":
      return changed(
        await db
          .prepare(`UPDATE inbox_members SET admin=?4,muted=0 WHERE ${target} AND EXISTS(${owner})`)
          .bind(...args, Number(cmd.action === "promote"))
          .run(),
      );
    case "transfer":
      return changed(
        await db
          .prepare(
            `UPDATE inbox_rooms SET owner=?3,revision=revision+1 WHERE id=?1 AND owner=?2 AND kind='group'
        AND ?2!=?3 AND EXISTS(SELECT 1 FROM inbox_members WHERE room=?1 AND person=?3 AND state='active')`,
          )
          .bind(...args)
          .run(),
      );
    case "mute":
    case "unmute":
      return changed(
        await db
          .prepare(`UPDATE inbox_members SET muted=?4 WHERE ${target} AND admin=0 AND ${manager}`)
          .bind(...args, Number(cmd.action === "mute"))
          .run(),
      );
    case "remove":
      return changed(
        await db
          .prepare(`DELETE FROM inbox_members WHERE ${target} AND ${manager}`)
          .bind(...args)
          .run(),
      );
    case "ban":
      return changed(
        await db
          .prepare(
            `INSERT INTO inbox_group_bans(room,person)
        SELECT room,person FROM inbox_members WHERE ${target} AND ${manager}
        UNION SELECT room,person FROM inbox_group_requests WHERE room=?1 AND person=?3 AND ?2!=?3 AND ${manager}`,
          )
          .bind(...args)
          .run(),
      );
    case "unban": {
      const [result] = await db.batch([
        db.prepare(`DELETE FROM inbox_group_bans WHERE room=?1 AND person=?3 AND ${manager}`).bind(...args),
        db.prepare("UPDATE inbox_rooms SET revision=revision+1 WHERE id=? AND changes()=1").bind(room),
      ]);
      return changed(result);
    }
    case "deny":
      return changed(
        await db
          .prepare(`DELETE FROM inbox_group_requests WHERE room=?1 AND person=?3 AND ${manager}`)
          .bind(...args)
          .run(),
      );
    case "approve":
      return changed(
        await db
          .prepare(
            `INSERT INTO inbox_members(room,person,state,after_seq)
        SELECT r.id,?3,'active',${boundary} FROM inbox_rooms r WHERE r.id=?1 AND ${manager}
        AND r.invite_until>?5 AND ${roomCapacity}
        AND (SELECT count(*) FROM inbox_members WHERE person=?3 AND state='active')<200
        AND NOT EXISTS(SELECT 1 FROM inbox_blocks WHERE person=?3 AND sender=r.owner)
        AND EXISTS(SELECT 1 FROM inbox_group_requests WHERE room=r.id AND person=?3)`,
          )
          .bind(...args, Date.now() - week, Date.now())
          .run(),
      );
  }
}
