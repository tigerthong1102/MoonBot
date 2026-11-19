import { inboxLanguage, mailText, supportedInboxLanguage } from "./inbox-language";
import { z } from "zod";
import { redactSecretsInText } from "../../../shared/redact";
import type { InboxEnv } from "./personal-inbox-worker";
import { HTTPError, json, readBoundedJSON } from "./http";

export const guestOptions = z.object({
  locale: z.string().refine(supportedInboxLanguage),
  note: z.string().trim().max(500).default(""),
});
export type GuestOptions = z.infer<typeof guestOptions>;
const week = 7 * 86400_000;
const day = 86400_000;

export async function allowPilotLogin(env: InboxEnv, email: string) {
  const seeds = (env.INBOX_PILOT_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase());
  if (seeds.includes(email)) return true;
  return !!(await env.DB.prepare(
    `SELECT 1 FROM "user" WHERE email=? AND emailVerified=1 UNION ALL
    SELECT 1 FROM inbox_guest_invites WHERE email=? AND created>=? LIMIT 1`,
  )
    .bind(email, email, Date.now() - week)
    .first());
}

export async function claimGuestInvites(db: D1Database, user: string, email: string) {
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO inbox_members(room,person,state)
      SELECT i.room,?,'pending' FROM inbox_guest_invites i JOIN inbox_rooms r ON r.id=i.room
      WHERE i.email=? AND i.created>=? AND r.owner!=? AND
      (SELECT count(*) FROM inbox_members WHERE room=r.id)<20
      AND NOT EXISTS(SELECT 1 FROM inbox_blocks WHERE person=? AND sender IN (r.owner,i.sender))
      ORDER BY i.created LIMIT MAX(0,50-(SELECT count(*) FROM inbox_members WHERE person=? AND state='pending'))`,
      )
      .bind(user, email, Date.now() - week, user, user, user),
    db.prepare("DELETE FROM inbox_guest_invites WHERE email=?").bind(email),
  ]);
}

export async function suppressGuestMail(req: Request, db: D1Database) {
  const input = z.object({ token: z.uuid() }).safeParse(await readBoundedJSON(req));
  if (!input.success) throw new HTTPError(400, "invalid_request");
  await db.batch([
    db.prepare("UPDATE inbox_mail_preferences SET disabled=1 WHERE token=?").bind(input.data.token),
    db
      .prepare(
        "DELETE FROM inbox_guest_invites WHERE email=(SELECT email FROM inbox_mail_preferences WHERE token=?)",
      )
      .bind(input.data.token),
  ]);
  return json({ ok: true });
}

export async function recordGuestInvite(
  env: InboxEnv,
  owner: string,
  room: string,
  email: string,
  input: GuestOptions,
) {
  if (redactSecretsInText(input.note) !== input.note) throw new HTTPError(400, "contains_secret");
  const now = Date.now(),
    db = env.DB;
  const result = await db
    .prepare(
      `INSERT INTO inbox_guest_invites(room,email,locale,note,created,sender)
    SELECT r.id,?,?,?, ?,?6 FROM inbox_rooms r WHERE r.id=?5 AND (r.owner=?6 OR (r.kind='group' AND EXISTS(SELECT 1 FROM inbox_members a WHERE a.room=r.id AND a.person=?6 AND a.state='active' AND a.admin=1))) AND (r.kind='group' OR r.title=?7)
    AND NOT EXISTS(SELECT 1 FROM "user" WHERE email=? AND emailVerified=1)
    AND NOT EXISTS(SELECT 1 FROM inbox_mail_preferences WHERE email=? AND disabled=1)
    AND (SELECT count(*) FROM inbox_guest_invites WHERE email=? AND created>=?)<5
    AND (SELECT count(*) FROM inbox_members WHERE room=r.id)+(SELECT count(*) FROM inbox_guest_invites WHERE room=r.id AND created>=?)<20
    ON CONFLICT(room,email) DO UPDATE SET locale=excluded.locale,note=excluded.note,created=excluded.created,sender=excluded.sender,sent=NULL
    WHERE inbox_guest_invites.created<?`,
    )
    .bind(
      email,
      input.locale,
      input.note,
      now,
      room,
      owner,
      email,
      email,
      email,
      email,
      now - week,
      now - week,
      now - week,
    )
    .run();
  return !!result.meta.changes;
}

// Reserve each delivery before contacting the mail provider. An ambiguous provider response must not create a second unsolicited message.
export async function deliverGuestMail(env: InboxEnv, room: string, email: string) {
  const db = env.DB,
    now = Date.now();
  const [_, reservation, delivery] = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO inbox_mail_preferences(email,token) VALUES(?,?)")
      .bind(email, crypto.randomUUID()),
    db
      .prepare(
        `UPDATE inbox_mail_preferences SET last_attempt=? WHERE email=? AND disabled=0 AND last_attempt<?
      AND EXISTS(SELECT 1 FROM inbox_guest_invites WHERE room=? AND email=? AND sent IS NULL AND created>=?)
      AND NOT EXISTS(SELECT 1 FROM "user" WHERE email=? AND emailVerified=1)`,
      )
      .bind(now, email, now - day, room, email, now - week, email),
    db
      .prepare(
        `UPDATE inbox_guest_invites SET sent=? WHERE room=? AND email=? AND changes()=1 AND sent IS NULL
      RETURNING locale,note,(SELECT token FROM inbox_mail_preferences WHERE email=inbox_guest_invites.email) AS token,
      coalesce((SELECT email FROM "user" WHERE id=inbox_guest_invites.sender),(SELECT u.email FROM inbox_rooms r JOIN "user" u ON u.id=r.owner WHERE r.id=inbox_guest_invites.room)) AS sender`,
      )
      .bind(now, room, email),
  ]);
  if (!reservation.meta.changes || !delivery.results.length) return;
  const value = delivery.results[0] as { locale: string; note: string; token: string; sender: string };
  const language = inboxLanguage(value.locale);
  const subject = mailText(language,"emailSubject");
  const url = env.BETTER_AUTH_URL;
  const login = url + "/?lang=" + language + "#room=" + room;
  const stop = url + "/#stop=" + value.token + "&lang=" + language;
  const text = [
    mailText(language,"emailIntro",{sender:value.sender}), value.note,
    mailText(language,"emailOpen",{url:login}), mailText(language,"emailStop",{url:stop}),
  ].filter(Boolean).join("\n\n");
  await env.EMAIL.send({ from: { email: env.EMAIL_FROM, name: "StartupBot" }, to: email, subject, text });
}
