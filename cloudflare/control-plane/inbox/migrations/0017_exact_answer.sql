CREATE TABLE inbox_exact_seats (
  room TEXT NOT NULL, person TEXT NOT NULL, stamp TEXT NOT NULL,
  PRIMARY KEY(room,person),
  FOREIGN KEY(room,person) REFERENCES inbox_members(room,person) ON DELETE CASCADE
);
INSERT INTO inbox_exact_seats SELECT room,person,lower(hex(randomblob(16))) FROM inbox_members;
CREATE TRIGGER inbox_exact_new_seat AFTER INSERT ON inbox_members BEGIN
  INSERT INTO inbox_exact_seats VALUES(NEW.room,NEW.person,lower(hex(randomblob(16))));
END;
CREATE TRIGGER inbox_exact_changed_seat AFTER UPDATE OF state ON inbox_members WHEN OLD.state!=NEW.state BEGIN
  UPDATE inbox_exact_seats SET stamp=lower(hex(randomblob(16))) WHERE room=NEW.room AND person=NEW.person;
END;
CREATE TABLE inbox_exact_revoked (
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(owner,id)
);
ALTER TABLE inbox_posts ADD COLUMN exact_reply INTEGER NOT NULL DEFAULT 0 CHECK(exact_reply IN (0,1));
CREATE TABLE inbox_exact_grants (
  id TEXT PRIMARY KEY,
  pairing TEXT NOT NULL REFERENCES inbox_twin_pairings(id) ON DELETE CASCADE,
  owner TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  lesson TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  rooms TEXT NOT NULL,
  expires INTEGER NOT NULL,
  after_seq INTEGER,
  review_nonce TEXT,
  signatures INTEGER NOT NULL DEFAULT 0 CHECK(signatures BETWEEN 0 AND 20)
);
CREATE TRIGGER inbox_exact_forget_grant AFTER DELETE ON inbox_exact_grants BEGIN
  INSERT INTO inbox_exact_revoked(owner,id,expires) SELECT OLD.owner,OLD.id,OLD.expires FROM "user" WHERE id=OLD.owner
    ON CONFLICT(owner,id) DO UPDATE SET expires=max(expires,excluded.expires);
END;
CREATE TABLE inbox_exact_challenges (
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source INTEGER NOT NULL REFERENCES inbox_posts(seq) ON DELETE CASCADE,
  grant_id TEXT NOT NULL REFERENCES inbox_exact_grants(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 3),
  PRIMARY KEY(owner,source)
);
CREATE TABLE inbox_exact_receipts (
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source INTEGER NOT NULL REFERENCES inbox_posts(seq) ON DELETE CASCADE,
  grant_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  signed_message TEXT NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  PRIMARY KEY(owner,source)
);
CREATE TRIGGER inbox_exact_publish AFTER INSERT ON inbox_exact_receipts BEGIN
  INSERT INTO inbox_posts(room,author,nonce,kind,body,created,bot_name,exact_reply)
    VALUES ((SELECT room FROM inbox_posts WHERE seq=NEW.source), NEW.owner, NEW.nonce, 'text',
      (SELECT answer FROM inbox_exact_grants WHERE id=NEW.grant_id),
      CAST((julianday('now')-2440587.5)*86400000 AS INTEGER), 'Approved reply',1);
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'exact_reply_not_published') END;
  UPDATE inbox_exact_grants SET signatures=signatures+1 WHERE id=NEW.grant_id;
END;
