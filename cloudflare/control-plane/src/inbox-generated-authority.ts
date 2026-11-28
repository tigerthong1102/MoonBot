export const dbNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export const pairing = `JOIN inbox_twin_pairings k ON k.id=g.pairing AND k.owner=g.owner
 LEFT JOIN inbox_generated_leases a ON a.id=g.id`;

function sessionExpiry(alias: string) {
  return `CASE typeof(${alias}.expiresAt) WHEN 'integer' THEN ${alias}.expiresAt
    ELSE CAST((julianday(${alias}.expiresAt)-2440587.5)*86400000 AS INTEGER) END`;
}

export const online = `g.authority_until>${dbNow} AND k.inbox_session IS NOT NULL
  AND EXISTS(SELECT 1 FROM session d JOIN session v ON v.id=k.inbox_session WHERE d.id=k.desktop_session
    AND v.id!=d.id AND v.userId=g.owner AND d.userId=g.owner AND ${sessionExpiry("d")}>${dbNow} AND ${sessionExpiry("v")}>${dbNow})`;
export const original = `k.expires>${dbNow} AND g.expires>${dbNow} AND k.inbox_session IS NOT NULL`;
export const currentLease = "COALESCE(a.lease_expires,g.expires)";
export const live = `(${currentLease}>${dbNow} AND CASE WHEN a.id IS NOT NULL THEN (${online}) ELSE (${original}) END)`;
export const visibleAuthority = `(CASE WHEN a.id IS NOT NULL THEN (${online}) ELSE (${original}) END)`;
export const cleanupGrants = `DELETE FROM inbox_generated_grants WHERE expires<=${dbNow}
  AND NOT EXISTS(SELECT 1 FROM inbox_generated_leases a WHERE a.id=inbox_generated_grants.id AND inbox_generated_grants.authority_until>${dbNow})`;
export const tenMinuteCount = `(SELECT count(*) FROM inbox_generated_attempts t WHERE t.owner=g.owner AND t.reserved_at>${dbNow}-600000)`;
export const dailyCount = `(SELECT count(*) FROM inbox_generated_attempts t WHERE t.owner=g.owner AND t.reserved_at>${dbNow}-86400000)`;
export const budget = `((g.daily_limit IS NOT NULL OR g.attempts<5) AND
  NOT EXISTS(SELECT 1 FROM inbox_generated_cutover c WHERE c.owner=g.owner AND c.resumes>${dbNow}) AND ${tenMinuteCount}<5 AND ${dailyCount}<COALESCE(g.daily_limit,
  (SELECT l.daily_limit FROM inbox_generated_limits l WHERE l.owner=g.owner AND l.enforce_until>${dbNow}),720))`;

export const retainOnlinePairings = `AND NOT EXISTS(SELECT 1 FROM inbox_generated_grants g JOIN inbox_generated_leases a ON a.id=g.id
    WHERE g.pairing=inbox_twin_pairings.id AND g.authority_until>${dbNow})`;

export const hasOnlineSchema = async (db: D1Database) =>
  Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbox_generated_leases'").first());

export async function canManageOnline(db: D1Database, owner: string) {
  return (
    (await hasOnlineSchema(db)) &&
    Boolean(
      await db
        .prepare("SELECT 1 FROM inbox_generated_grants WHERE owner=? AND daily_limit IS NOT NULL")
        .bind(owner)
        .first(),
    )
  );
}
