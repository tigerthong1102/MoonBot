CREATE TABLE inbox_rooms (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct','group')),
  title TEXT NOT NULL,
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created INTEGER NOT NULL
);
CREATE INDEX inbox_owner ON inbox_rooms(owner, created);
CREATE TABLE inbox_members (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('active','pending')),
  after_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room, person)
);
CREATE INDEX inbox_person_rooms ON inbox_members(person, state);
CREATE TABLE inbox_posts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  author TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','skill','task')),
  body TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE (room, author, nonce)
);
CREATE INDEX inbox_room_history ON inbox_posts(room, seq);
CREATE INDEX inbox_post_expiry ON inbox_posts(created);
CREATE TABLE inbox_blocks (
  person TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  sender TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY(person, sender)
);

-- Membership is established exactly once, even when a create request is replayed after a decline.
CREATE TRIGGER inbox_room_created AFTER INSERT ON inbox_rooms BEGIN
  INSERT INTO inbox_members(room,person,state) VALUES(NEW.id,NEW.owner,'active');
  INSERT INTO inbox_members(room,person,state)
    SELECT NEW.id,u.id,'pending' FROM "user" u
    WHERE NEW.kind='direct' AND u.email=NEW.title AND u.id!=NEW.owner AND u.emailVerified=1
      AND NOT EXISTS (SELECT 1 FROM inbox_blocks WHERE person=u.id AND sender=NEW.owner)
      AND (SELECT count(*) FROM inbox_members WHERE person=u.id AND state='pending')<50;
END;

CREATE TABLE inbox_saved (
  person TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source_seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('skill','task')),
  body TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(person,source_seq)
);

CREATE TRIGGER inbox_block_added AFTER INSERT ON inbox_blocks BEGIN
  DELETE FROM inbox_members WHERE person=NEW.person AND room IN (
    SELECT id FROM inbox_rooms WHERE owner=NEW.sender
    AND (kind='direct' OR inbox_members.state='pending')
  );
  DELETE FROM inbox_rooms WHERE owner=NEW.person AND kind='direct' AND EXISTS (
    SELECT 1 FROM inbox_members WHERE room=inbox_rooms.id AND person=NEW.sender
  );
END;
