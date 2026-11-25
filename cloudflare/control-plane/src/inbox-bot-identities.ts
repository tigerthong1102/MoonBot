import { z } from "zod";
import { verifyBotClaim } from "../../../shared/bot-proof";
import { HTTPError, json, readBoundedJSON } from "./http";

export const identityScope = "00000000-0000-4000-8000-000000000000";
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("challenge"), bot: z.uuid() }),
  z.object({ action: z.literal("register"), bot: z.uuid(), name: z.string().trim().min(1).max(80), username: z.string().regex(/^bot_k[a-f0-9]{64}$/),
    proof: z.object({ nonce: z.uuid(), publicKey: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^[a-f0-9]{128}$/) }) }),
]);
const dbNow = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

export async function botIdentities(req: Request, db: D1Database, owner: string) {
  if (req.method !== "POST") throw new HTTPError(405, "method_not_allowed");
  const parsed = action.safeParse(await readBoundedJSON(req));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const input = parsed.data, now = Date.now();
  if (input.action === "challenge") {
    const nonce = crypto.randomUUID();
    const [, inserted] = await db.batch([
      db.prepare("DELETE FROM inbox_bot_identity_claims WHERE owner=? AND expires<=?").bind(owner, now),
      db.prepare("INSERT INTO inbox_bot_identity_claims(nonce,owner,bot,expires) SELECT ?1,?2,?3,?4 WHERE (SELECT count(*) FROM inbox_bot_identity_claims WHERE owner=?2)<20").bind(nonce, owner, input.bot, now + 300_000),
    ]);
    if (!inserted.meta.changes) throw new HTTPError(409, "unavailable");
    return json({ nonce });
  }
  const { proof } = input;
  const available = await db.prepare(`SELECT nonce FROM inbox_bot_identity_claims WHERE nonce=? AND owner=? AND bot=? AND expires>${dbNow}`).bind(proof.nonce, owner, input.bot).first();
  if (!available) throw new HTTPError(409, "unavailable");
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, value => Number.parseInt(value, 16));
  if (!await verifyBotClaim(bytes(proof.publicKey), input.username, { origin: new URL(req.url).origin, owner, bot: input.bot, room: identityScope, nonce: proof.nonce }, bytes(proof.signature))) throw new HTTPError(403, "invalid_bot_proof");
  try {
    const [, registered] = await db.batch([
      db.prepare(`DELETE FROM inbox_bot_identity_claims WHERE nonce=? AND owner=? AND bot=? AND expires>${dbNow}`).bind(proof.nonce, owner, input.bot),
      db.prepare(`INSERT INTO inbox_bots(id,owner,name,username,prepared_only) SELECT ?1,?2,?3,?4,1 WHERE changes()=1
        AND ((SELECT count(*) FROM inbox_bots WHERE owner=?2 AND prepared_only=1)<50 OR EXISTS(SELECT 1 FROM inbox_bots WHERE id=?1 AND owner=?2))
        ON CONFLICT(id) DO UPDATE SET username=COALESCE(inbox_bots.username,excluded.username)
        WHERE owner=?2 AND (inbox_bots.username IS NULL OR inbox_bots.username=excluded.username COLLATE NOCASE)`)
        .bind(input.bot, owner, "Bot", input.username),
    ]);
    if (!registered.meta.changes) {
      const capacity = await db.prepare("SELECT count(*) AS n FROM inbox_bots WHERE owner=? AND prepared_only=1").bind(owner).first<{ n: number }>();
      throw new HTTPError(409, (capacity?.n ?? 0) >= 50 ? "identity_capacity" : "unavailable");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: inbox_bots.username")) throw new HTTPError(409, "username_unavailable");
    throw error;
  }
  return json({ ok: true });
}
