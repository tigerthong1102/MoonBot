ALTER TABLE inbox_posts ADD COLUMN generated_notice TEXT;
ALTER TABLE inbox_posts ADD COLUMN generated_reply INTEGER NOT NULL DEFAULT 0 CHECK(generated_reply IN (0,1));
CREATE TABLE inbox_generated_grants (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  pairing TEXT NOT NULL REFERENCES inbox_twin_pairings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, rooms TEXT NOT NULL, expires INTEGER NOT NULL, review TEXT,
  after_seq INTEGER, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
);
CREATE TABLE inbox_generated_rooms (
  room TEXT PRIMARY KEY REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL REFERENCES inbox_generated_grants(id) ON DELETE CASCADE
);
CREATE TRIGGER inbox_generated_activate AFTER UPDATE OF after_seq ON inbox_generated_grants
  WHEN OLD.after_seq IS NULL AND NEW.after_seq IS NOT NULL BEGIN
  INSERT INTO inbox_generated_rooms(room,grant_id) SELECT substr(value,1,36),NEW.id FROM json_each(NEW.rooms);
END;
CREATE TABLE inbox_generated_revoked (
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, id TEXT NOT NULL, expires INTEGER NOT NULL,
  PRIMARY KEY(owner,id)
);
CREATE TRIGGER inbox_generated_forget AFTER DELETE ON inbox_generated_grants BEGIN
  INSERT INTO inbox_generated_revoked(owner,id,expires) SELECT OLD.owner,OLD.id,OLD.expires FROM "user" WHERE id=OLD.owner
    ON CONFLICT(owner,id) DO UPDATE SET expires=max(expires,excluded.expires);
END;
CREATE TABLE inbox_generated_jobs (
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source INTEGER NOT NULL REFERENCES inbox_posts(seq) ON DELETE CASCADE,
  grant_id TEXT NOT NULL REFERENCES inbox_generated_grants(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, input_hash TEXT,
  PRIMARY KEY(owner,source)
);
CREATE TRIGGER inbox_generated_reserve AFTER INSERT ON inbox_generated_jobs BEGIN
  UPDATE inbox_generated_grants SET attempts=attempts+1 WHERE id=NEW.grant_id;
END;
CREATE TABLE inbox_generated_receipts (
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, source INTEGER NOT NULL REFERENCES inbox_posts(seq) ON DELETE CASCADE,
  grant_id TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, answer TEXT, output_hash TEXT NOT NULL, signature TEXT NOT NULL,
  PRIMARY KEY(owner,source)
);
CREATE TRIGGER inbox_generated_publish AFTER INSERT ON inbox_generated_receipts BEGIN
  INSERT INTO inbox_posts(room,author,nonce,kind,body,created,bot_name,generated_reply)
    SELECT room,NEW.owner,NEW.nonce,'text',NEW.answer,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),'AI Twin',1 FROM inbox_posts WHERE seq=NEW.source;
  UPDATE inbox_generated_receipts SET answer=NULL WHERE owner=NEW.owner AND source=NEW.source;
END;
CREATE INDEX inbox_generated_inputs ON inbox_posts(generated_notice,seq) WHERE generated_notice IS NOT NULL;
CREATE INDEX inbox_generated_expiry ON inbox_generated_grants(expires);
CREATE TRIGGER inbox_generated_member_changed AFTER UPDATE OF state,muted,admin ON inbox_members
  WHEN (OLD.state='active' AND NEW.state!='active') OR (OLD.muted=0 AND NEW.muted!=0) OR
    (OLD.admin=1 AND NEW.admin=0 AND EXISTS(SELECT 1 FROM inbox_rooms r WHERE r.id=NEW.room AND r.kind='group' AND r.owner!=NEW.person)) BEGIN
  DELETE FROM inbox_generated_grants WHERE owner=NEW.person AND EXISTS(SELECT 1 FROM json_each(rooms) WHERE substr(value,1,36)=NEW.room);
  UPDATE inbox_posts SET generated_notice=NULL WHERE generated_notice IS NOT NULL AND author=NEW.person AND room=NEW.room;
END;
CREATE TRIGGER inbox_generated_member_left AFTER DELETE ON inbox_members BEGIN
  DELETE FROM inbox_generated_grants WHERE owner=OLD.person AND EXISTS(SELECT 1 FROM json_each(rooms) WHERE substr(value,1,36)=OLD.room);
  UPDATE inbox_posts SET generated_notice=NULL WHERE generated_notice IS NOT NULL AND author=OLD.person AND room=OLD.room;
END;
CREATE TRIGGER inbox_generated_blocked AFTER INSERT ON inbox_blocks BEGIN
  UPDATE inbox_posts SET generated_notice=NULL WHERE generated_notice IN (SELECT id FROM inbox_generated_grants WHERE owner=NEW.person) AND author=NEW.sender;
  UPDATE inbox_posts SET generated_notice=NULL WHERE generated_notice IN (SELECT id FROM inbox_generated_grants WHERE owner=NEW.sender) AND author=NEW.person;
END;
CREATE TRIGGER inbox_generated_source_changed AFTER UPDATE OF body,room,kind,author ON inbox_posts
  WHEN OLD.body IS NOT NEW.body OR OLD.room IS NOT NEW.room OR OLD.kind IS NOT NEW.kind OR OLD.author IS NOT NEW.author BEGIN
  UPDATE inbox_posts SET generated_notice=NULL WHERE seq=NEW.seq AND generated_notice IS NOT NULL;
END;
CREATE TRIGGER inbox_generated_manager_transferred AFTER UPDATE OF owner ON inbox_rooms
  WHEN OLD.owner!=NEW.owner AND OLD.kind='group' AND NOT EXISTS(
    SELECT 1 FROM inbox_members WHERE room=NEW.id AND person=OLD.owner AND state='active' AND muted=0 AND admin=1
  ) BEGIN
  DELETE FROM inbox_generated_grants WHERE owner=OLD.owner AND EXISTS(SELECT 1 FROM json_each(rooms) WHERE substr(value,1,36)=NEW.id);
END;
