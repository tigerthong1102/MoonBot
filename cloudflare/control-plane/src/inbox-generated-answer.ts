import {
  dbNow as now,
  pairing,
  budget,
  live,
  visibleAuthority,
  cleanupGrants,
  currentLease,
  tenMinuteCount,
  dailyCount,
} from "./inbox-generated-authority";
import { renewOnlineLease } from "./inbox-generated-renewal";
import { session, manages, scope, matchesRoom, noticeForViewer } from "./inbox-generated-scope";
import { z } from "zod";
import {
  generatedGrantMessage,
  generatedPostMessage,
  generatedRoomLimit,
  generatedRoomKinds,
} from "../../../electron/twin-generated-message.mjs";
import { holdsCredential, redactSecretsInText } from "../../../shared/redact";
import { HTTPError, json, readBoundedJSON } from "./http";
import { limitInboxAction } from "./personal-inbox";

const uuid = z.uuid(),
  signature = z.string().regex(/^[a-f0-9]{128}$/);
const safe = (value: string) =>
  !holdsCredential(value) &&
  redactSecretsInText(value) === value &&
  [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
const label = z.string().trim().min(1).max(128).refine(safe);
const providerShape = z.strictObject({
  key: uuid,
  model: label,
  name: label,
  destination: z
    .url()
    .max(256)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          value === url.origin &&
          (url.protocol === "https:" ||
            (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
        );
      } catch {
        return false;
      }
    }),
});
const rooms = z
  .array(z.union([z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9]{32}$/), z.enum(["all-direct", "all-managed-groups"])]))
  .min(1)
  .max(generatedRoomLimit)
  .refine((refs) => generatedRoomKinds(refs).length > 0 || refs.every((ref) => !ref.startsWith("all-")));
const ref = z.strictObject({ owner: uuid, id: uuid });
const job = { source: z.int().positive(), nonce: uuid };
const postedText = z
  .string()
  .trim()
  .min(1)
  .max(750)
  .refine((text) => !holdsCredential(text) && redactSecretsInText(text) === text);
const body = z.discriminatedUnion("action", [
  ref.extend({
    action: z.literal("offer"),
    pairing: uuid,
    rooms,
    expires: z.int(),
    provider: providerShape,
    dailyLimit: z.int().min(1).max(720).optional(),
    signature,
  }),
  ref.extend({ action: z.literal("inspect") }),
  ref.extend({
    action: z.literal("approve"),
    review: uuid,
    purpose: z.enum([
      "generated-inbox-answer-v1",
      "generated-current-and-future-inbox-v2",
      "generated-while-online-v3",
    ]),
  }),
  ref.extend({ action: z.literal("revoke") }),
  ref.extend({ action: z.literal("claim") }),
  ref.extend({ action: z.literal("lease") }),
  ref.extend({ action: z.literal("renew"), nonce: uuid, expires: z.int(), signature }),
  ref.extend({ action: z.literal("dispatch"), ...job }),
  ref.extend({ action: z.literal("check"), ...job }),
  ref.extend({ action: z.literal("finish"), ...job, answer: postedText, signature }),
]);

const missingRoom = (
  selected: string,
  owner: string,
) => `EXISTS(SELECT 1 FROM json_each(${selected}) pick WHERE pick.value NOT IN ('all-direct','all-managed-groups') AND NOT EXISTS(
 SELECT 1 ${scope} WHERE m.person=${owner} AND r.id||'.'||seat.stamp=pick.value AND ${manages}))`;
const eligible = `FROM inbox_generated_grants g ${pairing}
 JOIN inbox_generated_rooms chosen ON chosen.grant_id=g.id
 JOIN inbox_posts p ON p.room=chosen.room AND p.generated_notice=g.id
 JOIN inbox_rooms r ON r.id=p.room JOIN inbox_members m ON m.room=r.id AND m.person=g.owner AND m.state='active' AND m.muted=0
 JOIN inbox_exact_seats seat ON seat.room=r.id AND seat.person=m.person
 JOIN inbox_members sender ON sender.room=r.id AND sender.person=p.author AND sender.state='active' AND sender.muted=0
 JOIN "user" author ON author.id=p.author AND author.emailVerified=1
 WHERE ${session} AND ${manages} AND p.author!=g.owner AND p.seq>g.after_seq AND p.seq>COALESCE(a.after_gap_seq,0) AND p.seq>m.after_seq AND p.seq>sender.after_seq
 AND NOT EXISTS(SELECT 1 FROM inbox_members audience WHERE audience.room=p.room AND audience.state='active' AND audience.after_seq>=p.seq)
 AND p.kind='text' AND p.bot_name IS NULL AND length(p.body) BETWEEN 1 AND 1000
 AND ${matchesRoom}
 AND NOT EXISTS(SELECT 1 FROM inbox_blocks b WHERE (b.person=p.author AND b.sender=g.owner) OR (b.person=g.owner AND b.sender=p.author))
 AND NOT EXISTS(SELECT 1 FROM inbox_files f WHERE f.post=p.seq) AND NOT EXISTS(SELECT 1 FROM inbox_uploads u WHERE u.post=p.seq)
 AND NOT EXISTS(SELECT 1 FROM inbox_exact_receipts e WHERE e.owner=g.owner AND e.source=p.seq)
 AND NOT EXISTS(SELECT 1 FROM inbox_exact_grants e WHERE e.owner=g.owner AND e.after_seq<p.seq AND e.expires>${now} AND e.question=p.body AND e.signatures<20
   AND EXISTS(SELECT 1 FROM inbox_twin_pairings ek WHERE ek.id=e.pairing AND ek.inbox_session IS NOT NULL AND ek.expires>${now})
   AND EXISTS(SELECT 1 FROM json_each(e.rooms) er WHERE er.value='*' OR er.value=r.id||'.'||seat.stamp))`;
const unavailable = () => new HTTPError(409, "generated_reply_unavailable");
const hex = (value: string) => Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));
const bytes = (value: string) => new TextEncoder().encode(value);
async function verified(key: string, value: string, sig: string) {
  const imported = await crypto.subtle.importKey("raw", hex(key), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", imported, hex(sig), bytes(value));
}
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
type Grant = {
  id: string;
  provider: string;
  rooms: string;
  expires: number;
  after_seq: number | null;
  reviewer: number;
  attempts: number;
  daily_limit: number | null;
  authority_until: number | null;
  lease_end: number;
  usage_day: number;
  usage_window: number;
};

export async function inboxGeneratedAnswer(
  req: Request,
  db: D1Database,
  actor: { id: string; owner: string; expires: number },
  published: (room: string) => void,
  manageOnly = false,
) {
  const url = new URL(req.url),
    origin = url.origin,
    owner = actor.owner;
  if (req.method === "GET" && url.searchParams.get("rooms") === "1") {
    const visible = await db
      .prepare(
        `SELECT r.id,r.kind,r.id||'.'||seat.stamp AS ref,
      CASE WHEN r.kind='direct' THEN (SELECT u.email FROM inbox_members peer JOIN "user" u ON u.id=peer.person
      WHERE peer.room=r.id AND peer.person!=m.person AND peer.state='active' LIMIT 1) ELSE r.title END AS title
      ${scope} WHERE m.person=? AND ${manages} ORDER BY r.created,r.id`,
      )
      .bind(owner)
      .all<{ id: string; kind: string; ref: string; title: string | null }>();
    return json({ owner, rooms: visible.results });
  }
  if (req.method === "GET" && url.searchParams.has("notice")) {
    if (manageOnly) throw new HTTPError(404, "not_found");
    const room = url.searchParams.get("notice");
    if (!uuid.safeParse(room).success || !room) return json({ notice: null });
    const row = await noticeForViewer(db, room, owner, origin);
    if (!row?.id) return json({ notice: null });
    const { name, model, destination } = providerShape.parse(JSON.parse(row.provider));
    return json({ notice: { id: row.id, provider: { name, model, destination } } });
  }
  if (req.method === "GET") {
    const row = await db
      .prepare(
        `SELECT g.*,k.inbox_session=? AS reviewer,${currentLease} AS lease_end,CASE WHEN g.daily_limit IS NOT NULL THEN ${dailyCount} ELSE 0 END AS usage_day,CASE WHEN g.daily_limit IS NOT NULL THEN ${tenMinuteCount} ELSE 0 END AS usage_window FROM inbox_generated_grants g ${pairing}
      WHERE g.owner=? AND k.origin=? AND ${visibleAuthority}`,
      )
      .bind(actor.id, owner, origin)
      .first<Grant>();
    return json({
      owner,
      ...(manageOnly && { manageOnly: true }),
      now: Date.now(),
      grant: row && {
        id: row.id,
        reviewer: Boolean(row.reviewer),
        enabled: row.after_seq !== null,
        provider: JSON.parse(row.provider),
        rooms: JSON.parse(row.rooms),
        count: row.daily_limit === null ? row.attempts : row.usage_window,
        ...(row.daily_limit !== null && {
          dailyLimit: row.daily_limit,
          usedToday: row.usage_day,
          authorizedUntil: row.authority_until,
        }),
        expires: row.lease_end,
      },
    });
  }
  if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
  const parsed = body.safeParse(await readBoundedJSON(req, 8192));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const a = parsed.data;
  if (manageOnly && a.action !== "revoke") throw new HTTPError(404, "not_found");
  if (a.owner !== owner) throw unavailable();
  const args = [owner, a.id, origin, actor.id];
  if (a.action === "revoke") {
    const [, , , guard] = await db.batch([
      db.prepare(`DELETE FROM inbox_generated_revoked WHERE owner=? AND expires<=${now}`).bind(owner),
      db
        .prepare(
          `INSERT OR IGNORE INTO inbox_generated_revoked SELECT ?1,?2,${now}+600000
        WHERE EXISTS(SELECT 1 FROM inbox_generated_grants WHERE owner=?1 AND id=?2) OR
        (SELECT count(*) FROM inbox_generated_revoked WHERE owner=?1)<100`,
        )
        .bind(owner, a.id),
      db.prepare("DELETE FROM inbox_generated_grants WHERE id=? AND owner=?").bind(a.id, owner),
      db.prepare("SELECT 1 FROM inbox_generated_revoked WHERE owner=? AND id=?").bind(owner, a.id),
    ]);
    if (!guard.results.length) throw unavailable();
    return json({ id: a.id, revoked: true });
  }
  if (a.action === "offer") {
    await limitInboxAction(db, owner, "generated_offer", 6, 600000);
    if ([...new Set(a.rooms)].sort().join() !== a.rooms.join()) throw unavailable();
    const k = await db
      .prepare(
        `SELECT public_key,twin,revision FROM inbox_twin_pairings WHERE owner=? AND id=? AND origin=? AND desktop_session=? AND inbox_session IS NOT NULL AND expires>${now}`,
      )
      .bind(owner, a.pairing, origin, actor.id)
      .first<{ public_key: string; twin: string; revision: number }>();
    if (!k || !(await verified(k.public_key, generatedGrantMessage({ ...a, ...k, origin }), a.signature)))
      throw unavailable();
    const [, added] = await db.batch([
      db.prepare(cleanupGrants),
      db
        .prepare(
          `INSERT INTO inbox_generated_grants(id,owner,pairing,provider,rooms,expires,daily_limit,authority_until)
       SELECT ?2,?1,k.id,?6,?7,?8,?9,?10 FROM inbox_twin_pairings k WHERE k.owner=?1 AND k.origin=?3 AND k.desktop_session=?4 AND k.id=?5
       AND k.inbox_session IS NOT NULL AND ?8>${now} AND ?8<=MIN(k.expires,${now}+600000)
       AND NOT EXISTS(SELECT 1 FROM inbox_generated_revoked WHERE owner=?1 AND id=?2)
       AND NOT ${missingRoom("?7", "?1")} ON CONFLICT DO NOTHING`,
        )
        .bind(
          ...args,
          a.pairing,
          JSON.stringify(a.provider),
          JSON.stringify(a.rooms),
          a.expires,
          a.dailyLimit ?? null,
          a.dailyLimit ? actor.expires : null,
        ),
    ]);
    if (!added.meta.changes) throw unavailable();
    return json({ id: a.id, offered: true }, 201);
  }
  const reviewable = `id=?2 AND owner=?1 AND after_seq IS NULL AND expires>${now}
    AND EXISTS(SELECT 1 FROM inbox_twin_pairings k WHERE k.id=inbox_generated_grants.pairing AND k.origin=?3 AND k.inbox_session=?4 AND k.expires>${now})`;
  if (a.action === "inspect") {
    const review = crypto.randomUUID();
    const result = await db
      .prepare(`UPDATE inbox_generated_grants SET review=?5 WHERE ${reviewable}`)
      .bind(...args, review)
      .run();
    if (!result.meta.changes) throw unavailable();
    return json({ id: a.id, review });
  }
  if (a.action === "approve") {
    const [, , ok] = await db.batch([
      db.prepare(cleanupGrants),
      db
        .prepare(
          `DELETE FROM inbox_generated_rooms WHERE room IN(
        SELECT substr(p.value,1,36) FROM json_each((SELECT rooms FROM inbox_generated_grants WHERE ${reviewable} AND review=?5)) p)
        AND NOT EXISTS(SELECT 1 FROM inbox_generated_grants g ${pairing} WHERE g.id=inbox_generated_rooms.grant_id AND ${live})`,
        )
        .bind(...args, a.review),
      db
        .prepare(
          `UPDATE inbox_generated_grants SET review=NULL,after_seq=(SELECT COALESCE(max(seq),0) FROM inbox_posts),
         authority_until=CASE WHEN daily_limit IS NOT NULL THEN MIN(authority_until,?7) END
        WHERE ${reviewable} AND review=?5 AND ?6=CASE WHEN daily_limit IS NOT NULL THEN 'generated-while-online-v3' WHEN EXISTS(SELECT 1 FROM json_each(rooms) WHERE value IN ('all-direct','all-managed-groups'))
          THEN 'generated-current-and-future-inbox-v2' ELSE 'generated-inbox-answer-v1' END AND NOT ${missingRoom("rooms", "?1")}
        AND NOT EXISTS(SELECT 1 FROM inbox_generated_rooms old JOIN json_each(inbox_generated_grants.rooms) pick ON old.room=substr(pick.value,1,36))`,
        )
        .bind(...args, a.review, a.purpose, actor.expires),
    ]);
    if (!ok.meta.changes) throw unavailable();
    return json({ id: a.id, enabled: true });
  }
  if (a.action === "lease" || a.action === "renew") return renewOnlineLease(db, actor, origin, a);
  if (a.action === "claim") {
    await limitInboxAction(db, owner, "generated_poll", 90, 60000);
    const nonce = crypto.randomUUID();
    const [, result, status] = await db.batch<{
      source: number;
      room: string;
      nonce: string;
      expires: number;
      enabled: number;
    }>([
      db
        .prepare(
          `INSERT INTO inbox_generated_jobs(owner,source,grant_id,nonce,expires)
        SELECT g.owner,p.seq,g.id,?5,MIN(${currentLease},COALESCE(g.authority_until,k.expires),${now}+60000) ${eligible}
        AND (${budget}) AND NOT EXISTS(SELECT 1 FROM inbox_generated_attempts t WHERE t.owner=g.owner AND t.occupied_until>${now})
        AND NOT EXISTS(SELECT 1 FROM inbox_generated_jobs used WHERE used.owner=g.owner AND used.source=p.seq)
        AND NOT EXISTS(SELECT 1 FROM inbox_generated_jobs busy WHERE busy.owner=g.owner AND busy.expires>${now}
          AND NOT EXISTS(SELECT 1 FROM inbox_generated_receipts receipt WHERE receipt.nonce=busy.nonce))
        ORDER BY p.seq LIMIT 1 ON CONFLICT DO NOTHING`,
        )
        .bind(...args, nonce),
      db
        .prepare(
          "SELECT j.nonce,j.source,p.room,r.kind,j.expires FROM inbox_generated_jobs j JOIN inbox_posts p ON p.seq=j.source JOIN inbox_rooms r ON r.id=p.room WHERE j.owner=? AND j.nonce=?",
        )
        .bind(owner, nonce),
      db
        .prepare(
          `SELECT g.after_seq IS NOT NULL AS enabled FROM inbox_generated_grants g ${pairing} WHERE g.owner=?1 AND g.id=?2 AND k.origin=?3 AND k.desktop_session=?4 AND ${visibleAuthority}`,
        )
        .bind(...args),
    ]);
    return json({
      now: Date.now(),
      challenge: result.results[0] ?? null,
      enabled: Boolean(status.results[0]?.enabled),
      revoked: !status.results.length,
    });
  }
  const jobArgs = [...args, a.source, a.nonce];
  const activeJob = ` AND p.seq=?5 AND EXISTS(SELECT 1 FROM inbox_generated_jobs j WHERE j.owner=g.owner AND j.source=p.seq AND j.grant_id=g.id AND j.nonce=?6 AND j.expires>${now})`;
  const outputHash = a.action === "finish" ? await digest(a.answer) : "";
  if (a.action === "finish") {
    const prior = await db
      .prepare(
        "SELECT 1 FROM inbox_generated_receipts WHERE owner=? AND source=? AND grant_id=? AND nonce=? AND signature=? AND output_hash=?",
      )
      .bind(owner, a.source, a.id, a.nonce, a.signature, outputHash)
      .first();
    if (prior) return json({ published: true, source: a.source });
  }
  const row = await db
    .prepare(
      `SELECT p.body,p.room,p.room_kind,g.rooms,g.daily_limit,g.pairing,k.public_key,j.expires,j.input_hash FROM
    (SELECT p.body,p.room,r.kind AS room_kind,g.pairing,k.public_key,p.seq,g.id ${eligible}${activeJob}) AS p
    JOIN inbox_generated_jobs j ON j.source=p.seq AND j.grant_id=p.id
    JOIN inbox_generated_grants g ON g.id=p.id JOIN inbox_twin_pairings k ON k.id=g.pairing`,
    )
    .bind(...jobArgs)
    .first<{
      body: string;
      room: string;
      room_kind: string;
      daily_limit: number | null;
      rooms: string;
      pairing: string;
      public_key: string;
      expires: number;
      input_hash: string | null;
    }>();
  if (!row || row.body.length > 1000 || holdsCredential(row.body) || redactSecretsInText(row.body) !== row.body)
    throw unavailable();
  const inputHash = await digest(row.body);
  if (a.action === "dispatch") {
    const ok = await db
      .prepare(
        `UPDATE inbox_generated_jobs SET input_hash=?7 WHERE owner=?1 AND source=?5 AND nonce=?6 AND input_hash IS NULL
      AND expires>${now}+20000 AND EXISTS(SELECT 1 ${eligible}${activeJob} AND p.body=?8)`,
      )
      .bind(...jobArgs, inputHash, row.body)
      .run();
    if (!ok.meta.changes) throw unavailable();
    return json({ question: row.body, inputHash });
  }
  if (row.input_hash !== inputHash) throw unavailable();
  if (a.action === "check") return json({ active: true });
  if (
    !(await verified(
      row.public_key,
      generatedPostMessage({
        ...a,
        ...row,
        rooms: JSON.parse(row.rooms),
        kind: row.room_kind,
        dailyLimit: row.daily_limit ?? undefined,
        origin,
        inputHash,
      }),
      a.signature,
    ))
  )
    throw unavailable();
  await limitInboxAction(db, owner, "inbox_post", 60, 60000);
  const inserted = await db
    .prepare(
      `INSERT INTO inbox_generated_receipts(owner,source,grant_id,nonce,answer,signature,output_hash)
    SELECT g.owner,p.seq,g.id,?6,?7,?8,?10 ${eligible}${activeJob} AND p.body=?9
    AND NOT EXISTS(SELECT 1 FROM inbox_posts used WHERE used.room=p.room AND used.author=g.owner AND used.nonce=?6)
    ON CONFLICT DO NOTHING`,
    )
    .bind(...jobArgs, a.answer, a.signature, row.body, outputHash)
    .run();
  if (!inserted.meta.changes) {
    const duplicate = await db
      .prepare(
        "SELECT 1 FROM inbox_generated_receipts WHERE owner=? AND source=? AND nonce=? AND signature=? AND output_hash=?",
      )
      .bind(owner, a.source, a.nonce, a.signature, outputHash)
      .first();
    if (!duplicate) throw unavailable();
  } else published(row.room);
  return json({ published: true, source: a.source });
}
