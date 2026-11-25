import { z } from "zod";
import { verifyBotClaim } from "../../../shared/bot-proof";
import { redactSecretsInText } from "../../../shared/redact";
import { HTTPError, json, readBoundedJSON } from "./http";
import { canPost } from "./inbox-files";
import { groupManager } from "./inbox-group";

type BotRow = Record<string, string | number | null>;
const uuid = z.uuid();
const dbNow = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const actions = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    owner: z.string().min(1).max(128),
    bot: uuid,
    name: z.string().trim().min(1).max(80),
    username: z.string().regex(/^bot_k[a-f0-9]{64}$/).optional(),
    proof: z.object({ nonce: uuid, publicKey: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^[a-f0-9]{128}$/) }).optional(),
  }),
  z.object({ action: z.literal("challenge"), owner: z.string().min(1).max(128), bot: uuid }),
  z.object({ action: z.literal("add"), bot: uuid }),
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
const canInvite = `EXISTS(${canPost}) AND EXISTS(SELECT 1 FROM inbox_rooms WHERE id=?1 AND kind='group')`;
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
function addOwnedBot(db: D1Database, room: string, user: string, bot: string, afterRegistration = false) {
  return db.prepare(
    `INSERT OR IGNORE INTO inbox_room_bots(room,bot,owner) SELECT ?1,id,?2 FROM inbox_bots
    WHERE id=?3 AND owner=?2 AND ${canInvite} AND (SELECT count(*) FROM inbox_room_bots WHERE room=?1)<12 ${afterRegistration ? "AND changes()=1" : ""}`,
  ).bind(room, user, bot);
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
    if (new URL(req.url).searchParams.get("available") === "1") {
      const rows = await db.prepare(
        `SELECT b.id,b.name,b.username FROM inbox_bots b WHERE b.owner=?2 AND ${canInvite}
        AND NOT EXISTS(SELECT 1 FROM inbox_room_bots rb WHERE rb.room=?1 AND rb.bot=b.id)
        ORDER BY b.name,b.id`,
      ).bind(room, user).all<BotRow>();
      return json({ bots: rows.results.map(({ username, ...row }) => username === null ? row : { ...row, username }) });
    }
    const [members, rounds] = await db.batch<BotRow>([
      db
        .prepare(
          `SELECT b.id,b.name,b.username,u.email AS owner FROM inbox_room_bots rb JOIN inbox_bots b ON b.id=rb.bot
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
    return json({ bots: members.results.map(({ username, ...row }) => username === null ? row : { ...row, username }), round: rounds.results[0] ?? null });
  }
  const parsed = actions.safeParse(await readBoundedJSON(req));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const a = parsed.data,
    now = Date.now();
  if (a.action === "challenge") {
    if (a.owner !== user) throw new HTTPError(403, "unavailable");
    const nonce = crypto.randomUUID();
    const [, issued] = await db.batch<BotRow>([
      db.prepare("DELETE FROM inbox_bot_claims WHERE owner=? AND expires<=?").bind(user, now),
      db.prepare(`INSERT INTO inbox_bot_claims(nonce,owner,bot,room,expires) SELECT ?3,?2,?4,?1,?5 WHERE ${canInvite}
        AND (SELECT count(*) FROM inbox_bot_claims WHERE owner=?2)<20`).bind(room, user, nonce, a.bot, now + 5 * 60_000),
    ]);
    if (!issued.meta.changes) throw new HTTPError(409, "unavailable");
    const response = json({ nonce });
    response.headers.set("x-inbox-internal-silent", "1");
    return response;
  }
  if (a.action === "add") return changed((await addOwnedBot(db, room, user, a.bot).run()).meta.changes);
  if (a.action === "invite") {
    if (a.owner !== user) throw new HTTPError(403, "unavailable");
    if (Boolean(a.username) !== Boolean(a.proof)) throw new HTTPError(400, "invalid_request");
    if (a.username && a.proof) {
      const available = await db.prepare(`SELECT nonce FROM inbox_bot_claims WHERE nonce=? AND owner=? AND bot=? AND room=? AND expires>${dbNow}`).bind(a.proof.nonce, user, a.bot, room).first();
      if (!available) throw new HTTPError(409, "unavailable");
      const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, pair => Number.parseInt(pair, 16));
      const valid = await verifyBotClaim(bytes(a.proof.publicKey), a.username, { origin: new URL(req.url).origin, owner: user, bot: a.bot, room, nonce: a.proof.nonce }, bytes(a.proof.signature));
      if (!valid) throw new HTTPError(403, "invalid_bot_proof");
    }
    let registered: D1Result<BotRow>, members: D1Result<BotRow>;
    try {
    const operations = [
      ...(a.proof ? [db.prepare(`DELETE FROM inbox_bot_claims WHERE nonce=? AND owner=? AND bot=? AND room=? AND expires>${dbNow}`).bind(a.proof.nonce, user, a.bot, room)] : []),
      db
        .prepare(
          `INSERT INTO inbox_bots(id,owner,name,username) SELECT ?3,?2,?4,?5 WHERE ${canInvite}
        ${a.proof ? "AND changes()=1" : ""}
        AND (EXISTS(SELECT 1 FROM inbox_room_bots WHERE room=?1 AND bot=?3 AND owner=?2)
          OR (SELECT count(*) FROM inbox_room_bots WHERE room=?1)<12)
        AND ((SELECT count(*) FROM inbox_bots WHERE owner=?2)<50 OR EXISTS(SELECT 1 FROM inbox_bots WHERE id=?3 AND owner=?2)) ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=COALESCE(inbox_bots.username,excluded.username)
        WHERE owner=?2 AND (excluded.username IS NULL OR inbox_bots.username IS NULL OR inbox_bots.username=excluded.username COLLATE NOCASE)`,
        )
        .bind(room, user, a.bot, a.name, a.username ?? null),
      addOwnedBot(db, room, user, a.bot, true),
      db.prepare(`SELECT bot FROM inbox_room_bots WHERE room=?1 AND bot=?3 AND owner=?2 AND ${canInvite}`).bind(room, user, a.bot),
    ];
    const results = await db.batch<BotRow>(operations);
    registered = results[a.proof ? 1 : 0]!;
    members = results[a.proof ? 3 : 2]!;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: inbox_bots.username")) throw new HTTPError(409, "username_unavailable");
      throw error;
    }
    return changed(registered.meta.changes && members.results.length ? 1 : 0);
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
