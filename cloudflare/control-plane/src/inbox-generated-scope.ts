import { pairing, live, budget } from "./inbox-generated-authority";
export const session = `g.owner=?1 AND g.id=?2 AND k.origin=?3 AND k.desktop_session=?4 AND ${live}`;
export const manages = `((r.kind='group' AND (r.owner=m.person OR m.admin=1)) OR
 (r.kind='direct' AND (SELECT count(*) FROM inbox_members peers WHERE peers.room=r.id AND peers.state='active')=2))`;
export const scope = `FROM inbox_rooms r JOIN inbox_members m ON m.room=r.id AND m.state='active' AND m.muted=0
 JOIN inbox_exact_seats seat ON seat.room=r.id AND seat.person=m.person`;
export const wildcardRoom = `EXISTS(SELECT 1 FROM json_each(g.rooms) pick
  WHERE pick.value=CASE r.kind WHEN 'direct' THEN 'all-direct' WHEN 'group' THEN 'all-managed-groups' END)`;
export const matchesRoom = `(EXISTS(SELECT 1 FROM json_each(g.rooms) pick WHERE pick.value=r.id||'.'||seat.stamp) OR ${wildcardRoom})`;
export function noticeScope(room: string, viewer: string, origin: string) {
  return `FROM inbox_generated_grants g ${pairing}
    JOIN inbox_generated_rooms chosen ON chosen.grant_id=g.id JOIN inbox_rooms r ON r.id=chosen.room
    JOIN inbox_members m ON m.room=r.id AND m.person=g.owner AND m.state='active' AND m.muted=0
    JOIN inbox_exact_seats seat ON seat.room=r.id AND seat.person=m.person
    JOIN inbox_members viewer ON viewer.room=r.id AND viewer.person=${viewer} AND viewer.state='active' AND viewer.muted=0
    WHERE r.id=${room} AND viewer.person!=g.owner AND k.origin=${origin} AND ${live} AND ${manages}
    AND NOT EXISTS(SELECT 1 FROM inbox_blocks b WHERE (b.person=viewer.person AND b.sender=g.owner) OR (b.person=g.owner AND b.sender=viewer.person))
    AND g.after_seq IS NOT NULL AND (${budget}) AND ${matchesRoom}`;
}
export const grantedNoticeAtPost = `(SELECT g.id ${noticeScope("?1", "?2", "?8")} AND ?4='text' AND length(?5) BETWEEN 1 AND 1000 AND
  CASE WHEN a.id IS NOT NULL OR ${wildcardRoom} THEN EXISTS(SELECT 1 FROM inbox_generated_disclosures d
    WHERE d.grant_id=g.id AND d.token=?7 AND d.room=r.id AND d.viewer=viewer.person) ELSE g.id=?7 END)`;

export async function noticeForViewer(db: D1Database, room: string, viewer: string, origin: string) {
  const candidates = `SELECT g.id FROM inbox_rooms r JOIN inbox_members m ON m.room=r.id AND m.state='active' AND m.muted=0
    JOIN inbox_exact_seats seat ON seat.person=m.person AND seat.room=r.id JOIN inbox_generated_grants g ON g.owner=m.person ${pairing}
    WHERE r.id=?1 AND k.origin=?3 AND ${live} AND g.after_seq IS NOT NULL AND (${budget}) AND ${manages} AND (${wildcardRoom} OR (a.id IS NOT NULL AND ${matchesRoom}))
    LIMIT 2`;
  const authorizedViewer = `EXISTS(SELECT 1 FROM inbox_members v WHERE v.room=?1 AND v.person=?2 AND v.state='active' AND v.muted=0
    AND v.person!=g.owner AND NOT EXISTS(SELECT 1 FROM inbox_blocks b WHERE (b.person=v.person AND b.sender=g.owner) OR (b.person=g.owner AND b.sender=v.person)))`;
  const bound = noticeScope("?1", "?2", "?3");
  const args = [room, viewer, origin];
  const existing = `SELECT CASE WHEN a.id IS NOT NULL OR ${wildcardRoom} THEN (
    SELECT d.token FROM inbox_generated_disclosures d WHERE d.grant_id=g.id AND d.room=r.id AND d.viewer=viewer.person
    ) ELSE g.id END AS id,g.provider ${bound}`;
  const candidate = `SELECT g.id FROM candidates c JOIN inbox_generated_grants g ON g.id=c.id
    WHERE (SELECT count(*) FROM candidates)=1 AND ${authorizedViewer}
    AND NOT EXISTS(SELECT 1 FROM inbox_generated_rooms old JOIN inbox_generated_grants g ON g.id=old.grant_id ${pairing}
      WHERE old.room=?1 AND ${live})`;
  const current = await db
    .prepare(
      `WITH candidates AS (${candidates}) ${existing} UNION ALL
    SELECT NULL AS id,NULL AS provider FROM (${candidate}) LIMIT 1`,
    )
    .bind(...args)
    .first<{ id: string | null; provider: string }>();
  if (!current || current.id) return current;
  const result = await db.batch<{ id: string; provider: string }>([
    db
      .prepare(
        `DELETE FROM inbox_generated_rooms WHERE room=? AND EXISTS
      (SELECT 1 FROM inbox_generated_grants g ${pairing} WHERE g.id=inbox_generated_rooms.grant_id AND NOT ${live})`,
      )
      .bind(room),
    db
      .prepare(
        `WITH candidates AS (${candidates}) INSERT OR IGNORE INTO inbox_generated_rooms(room,grant_id)
      SELECT ?1,id FROM (${candidate})`,
      )
      .bind(...args),
    db
      .prepare(
        `INSERT OR IGNORE INTO inbox_generated_disclosures(token,grant_id,room,viewer)
      SELECT ?4,g.id,r.id,viewer.person ${bound} AND (a.id IS NOT NULL OR ${wildcardRoom})`,
      )
      .bind(...args, crypto.randomUUID()),
    db.prepare(existing).bind(...args),
  ]);
  return result[3].results[0];
}
