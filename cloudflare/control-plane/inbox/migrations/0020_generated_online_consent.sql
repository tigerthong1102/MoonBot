ALTER TABLE inbox_generated_grants ADD COLUMN daily_limit INTEGER CHECK(daily_limit BETWEEN 1 AND 720);
ALTER TABLE inbox_generated_grants ADD COLUMN authority_until INTEGER;
CREATE TABLE inbox_generated_leases (
  id TEXT PRIMARY KEY REFERENCES inbox_generated_grants(id) ON DELETE CASCADE,
  lease_expires INTEGER NOT NULL,
  after_gap_seq INTEGER NOT NULL DEFAULT 0, nonce TEXT, proposed_expires INTEGER,
  challenge_until INTEGER, accepted_nonce TEXT, accepted_signature TEXT
);
CREATE TABLE inbox_generated_limits (
  owner TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE, daily_limit INTEGER NOT NULL, enforce_until INTEGER NOT NULL
);
CREATE TRIGGER inbox_generated_require_online_approval BEFORE UPDATE OF after_seq ON inbox_generated_grants
  WHEN OLD.after_seq IS NULL AND NEW.after_seq IS NOT NULL AND NEW.daily_limit IS NOT NULL AND NEW.expires!=0 BEGIN
  SELECT RAISE(IGNORE);
END;
CREATE TRIGGER inbox_generated_start_online AFTER UPDATE OF after_seq ON inbox_generated_grants
  WHEN OLD.after_seq IS NULL AND NEW.after_seq IS NOT NULL AND NEW.daily_limit IS NOT NULL BEGIN
  INSERT INTO inbox_generated_leases(id,lease_expires) VALUES(NEW.id,OLD.expires);
  INSERT INTO inbox_generated_limits(owner,daily_limit,enforce_until) VALUES(NEW.owner,NEW.daily_limit,
    CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+86400000)
    ON CONFLICT(owner) DO UPDATE SET daily_limit=excluded.daily_limit,enforce_until=excluded.enforce_until;
END;
CREATE TABLE inbox_generated_attempts (
  nonce TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reserved_at INTEGER NOT NULL, occupied_until INTEGER NOT NULL
);
CREATE INDEX inbox_generated_attempt_window ON inbox_generated_attempts(owner,reserved_at);
CREATE INDEX inbox_generated_attempt_expiry ON inbox_generated_attempts(reserved_at);
INSERT INTO inbox_generated_attempts(nonce,owner,reserved_at,occupied_until)
  SELECT j.nonce,j.owner,MIN(j.expires,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),
    CASE WHEN r.nonce IS NULL THEN j.expires ELSE 0 END FROM inbox_generated_jobs j
    LEFT JOIN inbox_generated_receipts r ON r.nonce=j.nonce
    WHERE j.expires>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-86400000;
INSERT OR IGNORE INTO inbox_generated_attempts(nonce,owner,reserved_at,occupied_until)
  SELECT nonce,author,created,0 FROM inbox_posts WHERE generated_reply=1
    AND created>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-86400000;
CREATE TABLE inbox_generated_cutover (
  owner TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE, resumes INTEGER NOT NULL
);
INSERT INTO inbox_generated_cutover SELECT id,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+600000 FROM "user";
DROP TRIGGER inbox_generated_reserve;
CREATE TRIGGER inbox_generated_reserve AFTER INSERT ON inbox_generated_jobs BEGIN
  UPDATE inbox_generated_grants SET attempts=attempts+1 WHERE id=NEW.grant_id AND
    NOT EXISTS(SELECT 1 FROM inbox_generated_leases a WHERE a.id=NEW.grant_id);
  INSERT INTO inbox_generated_attempts(nonce,owner,reserved_at,occupied_until)
    SELECT NEW.nonce,NEW.owner,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),NEW.expires;
  INSERT INTO inbox_generated_limits(owner,daily_limit,enforce_until)
    SELECT g.owner,g.daily_limit,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+86400000
    FROM inbox_generated_grants g JOIN inbox_generated_leases a ON a.id=g.id WHERE g.id=NEW.grant_id
    ON CONFLICT(owner) DO UPDATE SET daily_limit=excluded.daily_limit,enforce_until=excluded.enforce_until;
END;
CREATE TRIGGER inbox_generated_complete_attempt AFTER INSERT ON inbox_generated_receipts BEGIN
  UPDATE inbox_generated_attempts SET occupied_until=0 WHERE nonce=NEW.nonce AND owner=NEW.owner;
END;
CREATE TRIGGER inbox_generated_new_lease AFTER UPDATE OF lease_expires ON inbox_generated_leases
  WHEN OLD.lease_expires<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND NEW.lease_expires>OLD.lease_expires BEGIN
  DELETE FROM inbox_generated_disclosures WHERE grant_id=NEW.id;
END;

DROP TRIGGER inbox_generated_forget;
CREATE TRIGGER inbox_generated_forget AFTER DELETE ON inbox_generated_grants BEGIN
  INSERT INTO inbox_generated_revoked(owner,id,expires)
    SELECT OLD.owner,OLD.id,iif(OLD.daily_limit IS NULL, OLD.expires,
      MAX(OLD.expires,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+600000))
    FROM "user" WHERE id=OLD.owner
    ON CONFLICT(owner,id) DO UPDATE SET expires=max(expires,excluded.expires);
END;
CREATE TRIGGER inbox_generated_owner_budget BEFORE INSERT ON inbox_generated_jobs BEGIN
  SELECT RAISE(IGNORE) WHERE EXISTS(
    WITH window(now) AS (SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
    SELECT 1 FROM window WHERE
      EXISTS(SELECT 1 FROM inbox_generated_cutover c WHERE c.owner=NEW.owner AND c.resumes>window.now) OR
      EXISTS(SELECT 1 FROM inbox_generated_attempts t WHERE t.owner=NEW.owner AND t.occupied_until>window.now) OR
      (SELECT count(*) FROM inbox_generated_attempts t WHERE t.owner=NEW.owner AND t.reserved_at>window.now-600000)>=5 OR
      (SELECT count(*) FROM inbox_generated_attempts t WHERE t.owner=NEW.owner AND t.reserved_at>window.now-86400000)>=COALESCE(
        (SELECT daily_limit FROM inbox_generated_grants WHERE id=NEW.grant_id AND owner=NEW.owner),
        (SELECT daily_limit FROM inbox_generated_limits l WHERE l.owner=NEW.owner AND l.enforce_until>window.now),720)
  );
END;
