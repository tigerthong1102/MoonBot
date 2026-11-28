export const dbNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export const pairing = "JOIN inbox_twin_pairings k ON k.id=g.pairing AND k.owner=g.owner";
export const live = `g.expires>${dbNow} AND k.expires>${dbNow} AND k.inbox_session IS NOT NULL`;
export const session = `g.owner=?1 AND g.id=?2 AND k.origin=?3 AND k.desktop_session=?4 AND ${live}`;
export const manages = `((r.kind='group' AND (r.owner=m.person OR m.admin=1)) OR
 (r.kind='direct' AND (SELECT count(*) FROM inbox_members peers WHERE peers.room=r.id AND peers.state='active')=2))`;
export const scope = `FROM inbox_rooms r JOIN inbox_members m ON m.room=r.id AND m.state='active' AND m.muted=0
 JOIN inbox_exact_seats seat ON seat.room=r.id AND seat.person=m.person`;
export function noticeScope(room: string, viewer: string, origin: string) {
  return `FROM inbox_generated_grants g ${pairing}
    JOIN inbox_generated_rooms chosen ON chosen.grant_id=g.id JOIN inbox_rooms r ON r.id=chosen.room
    JOIN inbox_members m ON m.room=r.id AND m.person=g.owner AND m.state='active' AND m.muted=0
    JOIN inbox_exact_seats seat ON seat.room=r.id AND seat.person=m.person
    JOIN inbox_members viewer ON viewer.room=r.id AND viewer.person=${viewer} AND viewer.state='active' AND viewer.muted=0
    WHERE r.id=${room} AND viewer.person!=g.owner AND k.origin=${origin} AND ${live} AND ${manages}
    AND NOT EXISTS(SELECT 1 FROM inbox_blocks b WHERE (b.person=viewer.person AND b.sender=g.owner) OR (b.person=g.owner AND b.sender=viewer.person))
    AND g.after_seq IS NOT NULL AND g.attempts<5 AND EXISTS(SELECT 1 FROM json_each(g.rooms) pick WHERE pick.value=r.id||'.'||seat.stamp)`;
}
export const grantedNoticeAtPost = `(SELECT g.id ${noticeScope("?1", "?2", "?8")} AND g.id=?7 AND ?4='text' AND length(?5) BETWEEN 1 AND 1000)`;
