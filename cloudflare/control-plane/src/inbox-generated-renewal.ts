import { generatedRenewalMessage } from "../../../electron/twin-generated-message.mjs";
import { dbNow, pairing, visibleAuthority, online } from "./inbox-generated-authority";
import { HTTPError, json } from "./http";
import { limitInboxAction } from "./personal-inbox";

type Request =
  | { action: "lease"; id: string }
  | { action: "renew"; id: string; nonce: string; expires: number; signature: string };
type Authority = {
  id: string;
  pairing: string;
  public_key: string;
  expires: number;
  until: number;
  enabled: number;
  daily_limit: number;
  nonce: string | null;
  proposed_expires: number | null;
  accepted_nonce: string | null;
  accepted_signature: string | null;
};
const unavailable = () => new HTTPError(409, "generated_reply_unavailable");
const access = `g.owner=?1 AND g.id=?2 AND k.origin=?3 AND k.desktop_session=?4 AND g.daily_limit IS NOT NULL`;
const decode = (s: string) => Uint8Array.from(s.match(/../g)!, (byte) => parseInt(byte, 16));

export async function renewOnlineLease(
  db: D1Database,
  actor: { id: string; owner: string },
  origin: string,
  request: Request,
) {
  const args = [actor.owner, request.id, origin, actor.id];
  const read = () =>
    db
      .prepare(
        `SELECT g.id,g.pairing,k.public_key,g.daily_limit,g.authority_until AS until,
    COALESCE(a.lease_expires,g.expires) AS expires,g.after_seq IS NOT NULL AS enabled,a.nonce,a.proposed_expires,a.accepted_nonce,a.accepted_signature
    FROM inbox_generated_grants g ${pairing} WHERE ${access} AND ${visibleAuthority}`,
      )
      .bind(...args)
      .first<Authority>();
  const receipt = (row: Authority) => ({
    id: row.id,
    now: Date.now(),
    expires: row.expires,
    authorizedUntil: row.until,
    enabled: Boolean(row.enabled),
  });
  await limitInboxAction(db, actor.owner, "generated_lease", 60, 60000);
  if (request.action === "lease") {
    await db
      .prepare(
        `UPDATE inbox_generated_leases SET nonce=?5,proposed_expires=MIN(${dbNow}+600000,
      (SELECT authority_until FROM inbox_generated_grants WHERE id=?2)),challenge_until=${dbNow}+15000
      WHERE id=?2 AND lease_expires<=${dbNow}+75000 AND (nonce IS NULL OR challenge_until<=${dbNow})
      AND EXISTS(SELECT 1 FROM inbox_generated_grants g ${pairing} WHERE ${access} AND ${online} AND a.id IS NOT NULL
        AND g.authority_until>a.lease_expires)`,
      )
      .bind(...args, crypto.randomUUID())
      .run();
    const row = await read();
    if (!row) throw unavailable();
    return json(
      row.nonce && row.proposed_expires
        ? { ...receipt(row), nonce: row.nonce, expires: row.proposed_expires }
        : receipt(row),
    );
  }
  const row = await read();
  if (!row?.enabled) throw unavailable();
  const accepted = (current: Authority) =>
    current.accepted_nonce === request.nonce &&
    current.accepted_signature === request.signature &&
    current.expires === request.expires &&
    current.expires > Date.now();
  if (accepted(row)) return json(receipt(row));
  if (row.nonce !== request.nonce || row.proposed_expires !== request.expires) throw unavailable();
  const pub = await crypto.subtle.importKey("raw", decode(row.public_key), { name: "Ed25519" }, false, ["verify"]);
  const message = generatedRenewalMessage({ ...request, origin, owner: actor.owner, pairing: row.pairing });
  if (!(await crypto.subtle.verify("Ed25519", pub, decode(request.signature), new TextEncoder().encode(message))))
    throw unavailable();
  await db
    .prepare(
      `UPDATE inbox_generated_leases SET
    after_gap_seq=CASE WHEN lease_expires<=${dbNow} THEN (SELECT COALESCE(MAX(seq),0) FROM inbox_posts) ELSE after_gap_seq END,
    lease_expires=?6,accepted_nonce=?5,accepted_signature=?7,nonce=NULL,challenge_until=NULL,proposed_expires=NULL
    WHERE id=?2 AND nonce=?5 AND proposed_expires=?6 AND challenge_until>${dbNow} AND ?6>${dbNow} AND ?6<=${dbNow}+600000
    AND EXISTS(SELECT 1 FROM inbox_generated_grants g ${pairing} WHERE ${access} AND ${online} AND g.authority_until>=?6)`,
    )
    .bind(...args, request.nonce, request.expires, request.signature)
    .run();
  const current = await read();
  if (!current || !accepted(current)) throw unavailable();
  return json(receipt(current));
}
