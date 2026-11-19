import { z } from "zod";
import { redactSecretsInText } from "../../../shared/redact";
import { HTTPError, json, readBoundedJSON } from "./http";
import { canPost } from "./inbox-files";
import { groupManager } from "./inbox-group";

type BotRow = Record<string, string | number | null>;
const uuid = z.uuid();
const actions = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    owner: z.string().min(1).max(128),
    bot: uuid,
    name: z.string().trim().min(1).max(80),
  }),
  z.object({ action: z.literal("remove"), bot: uuid }),
  z.object({
    action: z.literal("start"),
    round: uuid,
    first: uuid,
    second: uuid,
    topic: z.string().trim().min(1).max(1800),
    locale: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?$/),
  }),
  z.object({ action: z.literal("stop"), round: uuid }),
  z.object({ action: z.literal("claim"), bot: uuid }),
  z.object({
    action: z.literal("reply"),
    bot: uuid,
    round: uuid,
    claim: uuid,
    text: z.string().trim().min(1).max(2400).nullable(),
  }),
]);
const active =
  "EXISTS(SELECT 1 FROM inbox_members WHERE room=?1 AND person=?2 AND state='active')";
const speaking = "CASE q.step WHEN 0 THEN q.first_bot ELSE q.second_bot END";
const writable = (
  person: string,
) => `EXISTS(SELECT 1 FROM inbox_members m JOIN inbox_rooms r ON r.id=m.room
  WHERE m.room=q.room AND m.person=${person} AND m.state='active' AND m.muted=0 AND (r.announcements=0 OR r.owner=m.person OR m.admin=1))`;
const turn = `q.step IN (0,1) AND q.expires>?4 AND ${speaking}=?3 AND b.id=?3 AND b.owner=?2 AND ${writable("b.owner")} AND ${writable("q.starter")}`;
function changed(n: number) {
  if (!n) throw new HTTPError(409, "unavailable");
  return json({ ok: true });
}
export async function pendingBotTurns(db: D1Database, user: string) {
  const rows = await db
    .prepare(
      `SELECT q.room,b.id AS bot FROM inbox_bot_rounds q JOIN inbox_bots b ON b.id=${speaking}
    WHERE b.owner=?1 AND q.step IN (0,1) AND q.claim IS NULL AND q.expires>?2 AND ${writable("b.owner")} AND ${writable("q.starter")}
    AND NOT EXISTS(SELECT 1 FROM inbox_bot_usage u WHERE u.bot=b.id AND u.window_start>?3 AND u.turns>=8) LIMIT 8`,
    )
    .bind(user, Date.now(), Date.now() - 86400_000)
    .all<BotRow>();
  return json({ jobs: rows.results });
}
export async function roomBots(
  req: Request,
  db: D1Database,
  room: string,
  user: string,
) {
  if (req.method === "GET") {
    const [members, rounds] = await db.batch<BotRow>([
      db
        .prepare(
          `SELECT b.id,b.name,u.email AS owner FROM inbox_room_bots rb JOIN inbox_bots b ON b.id=rb.bot
        JOIN "user" u ON u.id=b.owner WHERE rb.room=?1 AND ${active} ORDER BY b.name,b.id`,
        )
        .bind(room, user),
      db
        .prepare(
          `SELECT q.id,q.starter,CASE WHEN p.seq>m.after_seq THEN q.topic END AS topic,q.step,q.expires
           FROM inbox_bot_rounds q JOIN inbox_members m ON m.room=q.room
           JOIN inbox_posts p ON p.room=q.room AND p.author=q.starter AND p.nonce=q.id
           WHERE q.room=?1 AND m.person=?2 AND m.state='active' AND q.expires>?3`,
        )
        .bind(room, user, Date.now()),
    ]);
    return json({ bots: members.results, round: rounds.results[0] ?? null });
  }
  const parsed = actions.safeParse(await readBoundedJSON(req));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const a = parsed.data,
    now = Date.now();
  if (a.action === "invite") {
    if (a.owner !== user) throw new HTTPError(403, "unavailable");
    const canInvite = `EXISTS(${canPost}) AND EXISTS(SELECT 1 FROM inbox_rooms WHERE id=?1 AND kind='group')`;
    const [, result] = await db.batch<BotRow>([
      db
        .prepare(
          `INSERT INTO inbox_bots(id,owner,name) SELECT ?3,?2,?4 WHERE ${canInvite}
        AND (SELECT count(*) FROM inbox_bots WHERE owner=?2)<50 ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE owner=?2`,
        )
        .bind(room, user, a.bot, a.name),
      db
        .prepare(
          `INSERT OR IGNORE INTO inbox_room_bots(room,bot,owner) SELECT ?1,id,?2 FROM inbox_bots
        WHERE id=?3 AND owner=?2 AND ${canInvite} AND (SELECT count(*) FROM inbox_room_bots WHERE room=?1)<12`,
        )
        .bind(room, user, a.bot),
    ]);
    return changed(result.meta.changes);
  }
  if (a.action === "remove")
    return changed(
      (
        await db
          .prepare(
            `DELETE FROM inbox_room_bots WHERE room=?1 AND bot=?3 AND EXISTS(${groupManager})`,
          )
          .bind(room, user, a.bot)
          .run()
      ).meta.changes,
    );
  if (a.action === "stop")
    return changed(
      (
        await db
          .prepare(
            `DELETE FROM inbox_bot_rounds WHERE room=?1 AND id=?3 AND (starter=?2 OR EXISTS(${groupManager}))`,
          )
          .bind(room, user, a.round)
          .run()
      ).meta.changes,
    );
  if (a.action === "start") {
    if (a.first === a.second || redactSecretsInText(a.topic) !== a.topic)
      throw new HTTPError(400, "invalid_request");
    const [, result] = await db.batch<BotRow>([
      db
        .prepare(
          "DELETE FROM inbox_bot_rounds WHERE room=? AND (expires<=? OR step=-1)",
        )
        .bind(room, now),
      db
        .prepare(
          `INSERT OR IGNORE INTO inbox_bot_rounds(id,room,starter,topic,locale,first_bot,second_bot,expires)
        SELECT ?3,?1,?2,?4,?5,b.bot,c.bot,?8 FROM inbox_room_bots b JOIN inbox_room_bots c ON b.room=c.room
        WHERE b.room=?1 AND b.bot=?6 AND c.bot=?7 AND EXISTS(${canPost})
          AND NOT EXISTS(SELECT 1 FROM inbox_members m JOIN inbox_rooms r ON r.id=m.room
            WHERE m.room=?1 AND m.person IN (b.owner,c.owner)
            AND (m.state!='active' OR m.muted!=0 OR (r.announcements=1 AND m.admin=0 AND r.owner!=m.person)))
          AND NOT EXISTS(SELECT 1 FROM inbox_bot_usage WHERE bot IN (?6,?7) AND turns>=8 AND window_start>?9)`,
        )
        .bind(
          room,
          user,
          a.round,
          a.topic,
          a.locale,
          a.first,
          a.second,
          now + 10 * 60_000,
          now - 86400_000,
        ),
      db
        .prepare(
          `INSERT INTO inbox_posts(room,author,nonce,kind,body,created) SELECT ?1,?2,?3,'text',?4,?5 WHERE changes()=1`,
        )
        .bind(room, user, a.round, a.topic, now),
    ]);
    return changed(result.meta.changes);
  }
  if (a.action === "claim") {
    const key = crypto.randomUUID();
    // A claimed inference is never retried automatically: disconnecting after a provider charge must not charge twice.
    const [claimed] = await db.batch<BotRow>([
      db
        .prepare(
          `UPDATE inbox_bot_rounds AS q SET claim=?5 WHERE room=?1 AND claim IS NULL AND EXISTS
        (SELECT 1 FROM inbox_bots b WHERE ${turn}) AND NOT EXISTS(SELECT 1 FROM inbox_bot_usage WHERE bot=?3 AND window_start>?6 AND turns>=8)
        RETURNING id,topic,prior,locale,claim`,
        )
        .bind(room, user, a.bot, now, key, now - 86400_000),
      db
        .prepare(
          `INSERT INTO inbox_bot_usage(bot,window_start,turns) SELECT ?1,?2,1 WHERE changes()=1
        ON CONFLICT(bot) DO UPDATE SET turns=CASE WHEN window_start<=?3 THEN 1 ELSE turns+1 END,
        window_start=CASE WHEN window_start<=?3 THEN excluded.window_start ELSE window_start END`,
        )
        .bind(a.bot, now, now - 86400_000),
    ]);
    return json({ job: claimed.results[0] ?? null });
  }
  const text = a.text === null ? null : redactSecretsInText(a.text);
  const valid = `q.room=?1 AND q.id=?5 AND q.claim=?6 AND ${turn}`;
  const args = [room, user, a.bot, now, a.round, a.claim];
  if (text === null)
    return changed(
      (
        await db
          .prepare(
            `UPDATE inbox_bot_rounds AS q SET step=-1,claim=NULL WHERE EXISTS(SELECT 1 FROM inbox_bots b WHERE ${valid})`,
          )
          .bind(...args)
          .run()
      ).meta.changes,
    );
  const [post] = await db.batch<BotRow>([
    db
      .prepare(
        `INSERT INTO inbox_posts(room,author,nonce,kind,body,created,bot_name)
      SELECT q.room,b.owner,q.claim,'text',?7,?4,b.name FROM inbox_bot_rounds q JOIN inbox_bots b ON b.id=?3 WHERE ${valid}`,
      )
      .bind(...args, text),
    db
      .prepare(
        "DELETE FROM inbox_bot_rounds WHERE room=? AND id=? AND step=1 AND claim=? AND changes()=1",
      )
      .bind(room, a.round, a.claim),
    db
      .prepare(
        `UPDATE inbox_bot_rounds SET step=1,prior=?4,prior_seq=(SELECT seq FROM inbox_posts WHERE room=?1 AND nonce=?3 AND author=?5),claim=NULL WHERE room=?1 AND id=?2 AND claim=?3 AND step=0
      AND EXISTS(SELECT 1 FROM inbox_posts WHERE room=?1 AND nonce=?3 AND author=?5)`,
      )
      .bind(room, a.round, a.claim, text, user),
  ]);
  return changed(post.meta.changes);
}
