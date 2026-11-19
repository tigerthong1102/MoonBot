CREATE TABLE inbox_guest_invites_new (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  email TEXT NOT NULL, locale TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL, sent INTEGER, sender TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  PRIMARY KEY(room,email)
);
INSERT INTO inbox_guest_invites_new(room,email,locale,note,created,sent,sender)
  SELECT room,email,locale,note,created,sent,sender FROM inbox_guest_invites;
DROP TABLE inbox_guest_invites;
ALTER TABLE inbox_guest_invites_new RENAME TO inbox_guest_invites;
CREATE INDEX inbox_guest_address ON inbox_guest_invites(email,created);
CREATE TABLE inbox_languages (
 person TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE, locale TEXT NOT NULL
);
