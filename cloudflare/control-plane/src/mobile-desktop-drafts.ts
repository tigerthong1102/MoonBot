import { z } from "zod";
import { accountSession, type ControlPlaneAuth } from "./auth";
import { HTTPError, json, readBoundedJSON } from "./http";
import { requireInstallation } from "./installations";

const uuid = z.uuid();
const publicKey = z.string().regex(/^[A-Za-z0-9+/]{87}=$/);
const destination = z.strictObject({
  id: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  target: uuid.optional(),
});
const packet = z.strictObject({
  key: publicKey,
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  data: z
    .string()
    .min(24)
    .max(11000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
const envelope = z
  .string()
  .max(12000)
  .refine((value) => {
    try {
      return packet.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  });
const offer = destination.extend({ installation: uuid, listener: uuid, envelope });
const receipt = z.strictObject({ id: uuid });
const device = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("poll"), listener: uuid, publicKey }),
  z.strictObject({ action: z.literal("close"), listener: uuid }),
  z.strictObject({ action: z.literal("ack"), listener: uuid, id: uuid }),
]);
const destinations = `SELECT i.id,i.display_name AS name,r.listener,r.public_key AS publicKey,r.expires AS leaseExpires FROM mobile_draft_receivers r
  JOIN installations i ON i.id=r.installation JOIN installation_credentials c ON c.lookup_id=r.credential
  WHERE i.owner_user_id=?1 AND i.revoked_at IS NULL AND c.installation_id=i.id AND c.revoked_at IS NULL
  AND c.expires_at>?2 AND r.expires>?2 AND coalesce(i.kind,'desktop')='desktop'`;
const publicState = (state: string, expires: number, now: number) =>
  state === "received" ? state : expires <= now ? "expired" : "waiting";

export async function sweepMobileDrafts(db: D1Database, now = Date.now()) {
  await db.batch([
    db
      .prepare("UPDATE mobile_desktop_drafts SET envelope=NULL WHERE envelope IS NOT NULL AND expires<=?")
      .bind(now),
    db.prepare("DELETE FROM mobile_desktop_drafts WHERE expires<?").bind(now - 86400_000),
    db.prepare("DELETE FROM mobile_draft_receivers WHERE expires<=?").bind(now),
  ]);
}

export async function mobileDraftAccount(req: Request, env: Env, auth: ControlPlaneAuth, operation: string) {
  const session = await accountSession(req, auth);
  if (!session?.user.emailVerified) throw new HTTPError(401, "unauthorized");
  const body = await readBoundedJSON(req),
    owner = session.user.id,
    now = Date.now();
  if (operation === "status") {
    const parsed = receipt.safeParse(body);
    if (!parsed.success) throw new HTTPError(400, "invalid_request");
    const row = await env.DB.prepare(
      "SELECT state,expires FROM mobile_desktop_drafts WHERE owner=? AND id=? AND session=?",
    )
      .bind(owner, parsed.data.id, session.session.id)
      .first<{ state: string; expires: number }>();
    return json({ state: row ? publicState(row.state, row.expires, now) : "expired" });
  }
  const parsed = (operation === "targets" ? destination : offer).safeParse(body);
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const { id, target, fingerprint } = parsed.data;
  const available = (
    await env.DB.prepare(destinations)
      .bind(owner, now)
      .all<{ id: string; name: string; listener: string; publicKey: string }>()
  ).results;
  if (operation === "targets") {
    const existing = await env.DB.prepare(
      "SELECT state,expires,session,fingerprint,installation FROM mobile_desktop_drafts WHERE owner=? AND id=?",
    )
      .bind(owner, id)
      .first();
    if (existing) {
      if (
        existing.session !== session.session.id ||
        existing.fingerprint !== fingerprint ||
        (target && existing.installation !== target)
      )
        throw new HTTPError(409, "request_conflict");
      return json({ state: publicState(String(existing.state), Number(existing.expires), now) });
    }
    if (!target && available.length > 1)
      return json({
        state: "choose",
        devices: available.map(({ id, name, listener }) => ({ id, name, code: listener.slice(0, 8) })),
      });
    const selected = available.find((item) => !target || item.id === target);
    return json(
      selected
        ? { state: "ready", id: selected.id, listener: selected.listener, publicKey: selected.publicKey }
        : { state: "offline" },
    );
  }
  const delivery = offer.parse(body);
  const expires = Math.min(now + 15_000, new Date(session.session.expiresAt).getTime());
  const [, record] = await env.DB.batch<Record<string, string | number>>([
    env.DB.prepare(
      `WITH available AS (${destinations})
      INSERT OR IGNORE INTO mobile_desktop_drafts(owner,id,session,installation,listener,fingerprint,envelope,state,created,expires)
      SELECT ?1,?3,?4,id,listener,?5,?6,'offered',?2,min(?7,a.leaseExpires) FROM available a
      WHERE id=?9 AND listener=?10 AND ((?8 IS NULL AND (SELECT count(*) FROM available)=1) OR id=?8)
      AND NOT EXISTS(SELECT 1 FROM mobile_desktop_drafts d WHERE d.installation=a.id AND d.expires>?2 AND d.state!='received')
      AND (SELECT count(*) FROM mobile_desktop_drafts WHERE owner=?1 AND created>?2-60000)<10`,
    ).bind(
      owner,
      now,
      id,
      session.session.id,
      fingerprint,
      delivery.envelope,
      expires,
      target ?? null,
      delivery.installation,
      delivery.listener,
    ),
    env.DB.prepare("SELECT * FROM mobile_desktop_drafts WHERE owner=? AND id=?").bind(owner, id),
  ]);
  const row = record.results[0];
  if (row) {
    if (
      row.session !== session.session.id ||
      row.fingerprint !== fingerprint ||
      (target && target !== row.installation)
    )
      throw new HTTPError(409, "request_conflict");
    return json({ state: publicState(String(row.state), Number(row.expires), now) });
  }

  return json(
    !target && available.length > 1
      ? {
          state: "choose",
          devices: available.map(({ id, name, listener }) => ({ id, name, code: listener.slice(0, 8) })),
        }
      : { state: available.some((item) => !target || item.id === target) ? "busy" : "offline" },
  );
}

export async function mobileDraftDevice(req: Request, env: Env) {
  const auth = await requireInstallation(req, env);
  const parsed = device.safeParse(await readBoundedJSON(req));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const input = parsed.data,
    db = env.DB,
    id = auth.installation_id,
    now = Date.now();
  const valid = `EXISTS(SELECT 1 FROM installation_credentials c JOIN installations i ON i.id=c.installation_id
    WHERE i.id=?1 AND c.lookup_id=?3 AND i.revoked_at IS NULL AND c.revoked_at IS NULL AND c.expires_at>?4
    AND coalesce(i.kind,'desktop')='desktop')`;
  if (input.action === "close") {
    await db.batch([
      db
        .prepare("DELETE FROM mobile_draft_receivers WHERE installation=? AND listener=? AND credential=?")
        .bind(id, input.listener, auth.lookup_id),
      db
        .prepare(
          "UPDATE mobile_desktop_drafts SET envelope=NULL,expires=0 WHERE installation=? AND listener=? AND state='offered'",
        )
        .bind(id, input.listener),
    ]);
    return json({ ok: true });
  }
  if (input.action === "ack") {
    const result = await db
      .prepare(
        `UPDATE mobile_desktop_drafts SET state='received',envelope=NULL WHERE installation=?1 AND listener=?2
      AND id=?5 AND state IN ('claimed','received') AND expires>?4 AND ${valid}`,
      )
      .bind(id, input.listener, auth.lookup_id, now, input.id)
      .run();
    return json({ ok: result.meta.changes === 1 });
  }
  const [, claimed] = await db.batch<Record<string, string | number>>([
    db
      .prepare(
        `INSERT INTO mobile_draft_receivers(installation,listener,credential,expires,public_key) SELECT ?1,?2,?3,?4+6000,?5 WHERE ${valid}
      ON CONFLICT(installation) DO UPDATE SET listener=excluded.listener,credential=excluded.credential,expires=excluded.expires,public_key=excluded.public_key
      WHERE mobile_draft_receivers.listener=excluded.listener OR mobile_draft_receivers.expires<=?4`,
      )
      .bind(id, input.listener, auth.lookup_id, now, input.publicKey),
    db
      .prepare(
        `UPDATE mobile_desktop_drafts SET state='claimed' WHERE installation=?1 AND listener=?2 AND state='offered'
      AND expires>?4 AND ${valid} AND EXISTS(SELECT 1 FROM mobile_draft_receivers WHERE installation=?1 AND listener=?2 AND credential=?3 AND expires>?4)
      RETURNING id,envelope,expires`,
      )
      .bind(id, input.listener, auth.lookup_id, now),
  ]);
  const row = claimed.results[0];
  return json({
    draft: row ? { id: String(row.id), envelope: String(row.envelope), expires: Number(row.expires) } : null,
  });
}
