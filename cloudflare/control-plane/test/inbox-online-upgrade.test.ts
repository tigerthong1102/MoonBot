import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import { budget, pairing } from "../src/inbox-generated-authority";

it("keeps existing generated usage and outstanding work when upgrading an active D1 database", async () => {
  const db = env.INBOX_DB;
  const all = env.TEST_INBOX_MIGRATIONS;
  const migration = all.findIndex((m) => m.name.startsWith("0020_"));
  expect(migration).toBeGreaterThan(0);
  await applyD1Migrations(db, all.slice(0, migration));
  const now = Date.now();
  await db
    .prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
    .bind("owner", "Account", "upgrade@example.test", now, now)
    .run();
  for (const session of ["desk", "review"]) {
    await db
      .prepare("INSERT INTO session(id,userId,expiresAt,token,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .bind(session, "owner", now + 3600000, session, now, now)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO inbox_twin_pairings(id,origin,owner,desktop_session,review_session,inbox_session,public_key,fingerprint,twin,revision,expires,signed)
    VALUES('pair','https://inbox.example.test','owner','desk','review','review','fixture','fixture','twin',1,?,1)`,
    )
    .bind(now + 500000)
    .run();
  await db
    .prepare("INSERT INTO inbox_rooms(id,kind,title,owner,created) VALUES('room','group','Fixture','owner',?)")
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO inbox_posts(room,author,nonce,kind,body,created) VALUES('room','owner','source','text','Fixture',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO inbox_posts(room,author,nonce,kind,body,created,generated_reply) VALUES('room','owner','completed','text','Answer',?,1)",
    )
    .bind(now - 60000)
    .run();
  await db
    .prepare(
      `INSERT INTO inbox_generated_grants(id,pairing,owner,provider,rooms,expires,after_seq)
    VALUES('grant','pair','owner','{}','[]',?,0)`,
    )
    .bind(now + 500000)
    .run();
  await db
    .prepare(
      `INSERT INTO inbox_generated_jobs(owner,source,grant_id,nonce,expires)
    VALUES('owner',1,'grant','busy',?)`,
    )
    .bind(now + 45000)
    .run();
  await applyD1Migrations(db, all);
  expect(
    (await db.prepare("SELECT nonce,occupied_until FROM inbox_generated_attempts ORDER BY nonce").all()).results,
  ).toEqual([
    { nonce: "busy", occupied_until: now + 45000 },
    { nonce: "completed", occupied_until: 0 },
  ]);
  expect(
    await db
      .prepare(`SELECT (${budget}) AS permitted FROM inbox_generated_grants g ${pairing} WHERE g.id='grant'`)
      .first("permitted"),
  ).toBe(0);
  await db.prepare("INSERT INTO inbox_posts(room,author,nonce,kind,body,created) VALUES('room','owner','new-source','text','New question',?)").bind(now).run();
  const oldClaim=() => db.prepare(`INSERT INTO inbox_generated_jobs(owner,source,grant_id,nonce,expires)
    SELECT g.owner,p.seq,g.id,'old-writer',? FROM inbox_generated_grants g,inbox_posts p
    WHERE g.id='grant' AND p.nonce='new-source' AND g.attempts<5 ON CONFLICT DO NOTHING`).bind(now+60000).run();
  expect((await oldClaim()).meta.changes).toBe(0);
  await db.prepare("UPDATE inbox_generated_cutover SET resumes=0 WHERE owner='owner'").run();
  expect((await oldClaim()).meta.changes).toBe(0);
  await db.prepare("UPDATE inbox_generated_attempts SET occupied_until=0 WHERE nonce='busy'").run();
  await db.prepare("INSERT INTO inbox_generated_limits VALUES('owner',2,?)").bind(now+86400000).run();
  expect((await oldClaim()).meta.changes).toBe(0);
  await db.prepare("UPDATE inbox_generated_cutover SET resumes=? WHERE owner='owner'").bind(now+600000).run();
  await db.prepare("DELETE FROM inbox_posts WHERE nonce='source'").run();
  await db.prepare("DELETE FROM inbox_generated_grants WHERE id='grant'").run();
  expect(await db.prepare("SELECT count(*) AS n FROM inbox_generated_attempts WHERE owner='owner'").first("n")).toBe(2);
  expect(
    await db.prepare("SELECT resumes FROM inbox_generated_cutover WHERE owner='owner'").first<number>("resumes"),
  ).toBeGreaterThan(now + 599000);
  await db
    .prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
    .bind("new", "New", "fresh@example.test", now, now)
    .run();
  expect(await db.prepare("SELECT owner FROM inbox_generated_cutover WHERE owner='new'").first()).toBeNull();
});
