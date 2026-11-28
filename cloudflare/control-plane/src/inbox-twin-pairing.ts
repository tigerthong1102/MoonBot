import { z } from "zod";
import { twinPairingMessage } from "../../../electron/twin-pairing-message.mjs";
import { HTTPError, json, readBoundedJSON } from "./http";
import { limitInboxAction } from "./personal-inbox";

const hex = (bytes: number) =>
  z
    .string()
    .length(bytes * 2)
    .regex(/^[0-9a-f]+$/);
const base = z.strictObject({ owner: z.string().min(1).max(128), id: z.uuid() });
const input = z.discriminatedUnion("action", [
  base
    .omit({ id: true })
    .extend({ action: z.literal("start"), publicKey: hex(32), twin: z.uuid(), revision: z.int().positive() }),
  base.extend({ action: z.literal("inspect") }),
  base.extend({ action: z.literal("ready") }),
  base.extend({ action: z.literal("sign"), signature: hex(64) }),
  base.extend({ action: z.literal("confirm"), fingerprint: hex(32) }),
  base.extend({ action: z.literal("revoke") }),
]);

function bytes(hex: string) {
  return Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}

type Pairing = {
  id: string;
  owner: string;
  desktop_session: string;
  review_session: string | null;
  inbox_session: string | null;
  public_key: string;
  fingerprint: string;
  twin: string;
  revision: number;
  expires: number;
  signed: number;
};

export async function inboxTwinPairing(
  req: Request,
  db: D1Database,
  session: { id: string; owner: string; expires: number },
) {
  const { owner } = session;
  const origin = new URL(req.url).origin;
  if (req.method === "GET") {
    const rows = await db
      .prepare(
        "SELECT id, fingerprint, expires FROM inbox_twin_pairings WHERE owner=? AND origin=? AND inbox_session IS NOT NULL AND expires>CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER) ORDER BY expires DESC",
      )
      .bind(owner, origin)
      .all<{ id: string; fingerprint: string; expires: number }>();
    return json({ owner, now: Date.now(), pairings: rows.results });
  }
  const parsed = input.safeParse(await readBoundedJSON(req, 2048));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const a = parsed.data;
  const unavailable = () => new HTTPError(409, "pairing_unavailable");
  if (owner !== a.owner) throw unavailable();
  if (a.action === "start") {
    await limitInboxAction(db, owner, "twin_pair_start", 6, 600_000);
    const key = bytes(a.publicKey);
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", key)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    const id = crypto.randomUUID(),
      now = Date.now(),
      expires = Math.min(session.expires, now + 600_000);
    if (expires <= now) throw unavailable();
    await db
      .prepare(
        "INSERT INTO inbox_twin_pairings(id,origin,owner,desktop_session,public_key,fingerprint,twin,revision,expires) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .bind(id, origin, owner, session.id, a.publicKey, fingerprint, a.twin, a.revision, expires)
      .run();
    return json({ id, owner, fingerprint, expires, now }, 201);
  }
  if (a.action === "revoke") {
    await db
      .prepare("DELETE FROM inbox_twin_pairings WHERE owner=? AND id=? AND origin=?")
      .bind(owner, a.id, origin)
      .run();
    return json({ id: a.id, revoked: true });
  }
  await limitInboxAction(db, owner, "twin_pair_check", 60, 600_000);
  const row = await db
    .prepare(
      "SELECT * FROM inbox_twin_pairings WHERE owner=? AND id=? AND origin=? AND expires>CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER)",
    )
    .bind(owner, a.id, origin)
    .first<Pairing>();
  if (!row) throw unavailable();
  if (a.action === "ready") {
    if (row.desktop_session !== session.id || !row.review_session || row.signed) throw unavailable();
    return json({ id: row.id, ready: true });
  }
  if (a.action === "sign") {
    if (row.desktop_session !== session.id || !row.review_session || row.signed) throw unavailable();
    const key = await crypto.subtle.importKey("raw", bytes(row.public_key), "Ed25519", false, ["verify"]);
    const message = twinPairingMessage({ ...row, origin, publicKey: row.public_key });
    if (!(await crypto.subtle.verify("Ed25519", key, bytes(a.signature), new TextEncoder().encode(message))))
      throw unavailable();
    const written = await db
      .prepare(
        "UPDATE inbox_twin_pairings SET signed=1 WHERE owner=? AND id=? AND desktop_session=? AND review_session IS NOT NULL AND signed=0 AND expires>CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER)",
      )
      .bind(owner, a.id, session.id)
      .run();
    if (!written.meta.changes) throw unavailable();
    return json({ id: a.id, signed: true });
  }
  if (row.desktop_session === session.id || row.inbox_session) throw unavailable();
  if (a.action === "inspect") {
    const checked = await db
      .prepare(
        "UPDATE inbox_twin_pairings SET review_session=? WHERE owner=? AND id=? AND (review_session IS NULL OR review_session=?) AND desktop_session!=? AND inbox_session IS NULL AND expires>CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER)",
      )
      .bind(session.id, owner, a.id, session.id, session.id)
      .run();
    if (!checked.meta.changes) throw unavailable();
    return json({ id: row.id, owner, fingerprint: row.fingerprint, expires: row.expires });
  }
  const written = await db
    .prepare(
      "UPDATE inbox_twin_pairings SET inbox_session=?,expires=MIN(expires,?) WHERE owner=? AND id=? AND review_session=? AND fingerprint=? AND signed=1 AND inbox_session IS NULL AND expires>CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER) AND EXISTS(SELECT 1 FROM session WHERE id=? AND userId=?)",
    )
    .bind(session.id, session.expires, owner, a.id, session.id, a.fingerprint, session.id, owner)
    .run();
  if (!written.meta.changes) throw unavailable();
  return json({ id: a.id, paired: true });
}
