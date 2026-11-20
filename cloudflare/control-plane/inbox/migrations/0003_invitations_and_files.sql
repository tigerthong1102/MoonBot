CREATE TABLE inbox_guest_invites (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('vi','en')),
  note TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  sent INTEGER,
  PRIMARY KEY(room,email)
);
CREATE INDEX inbox_guest_address ON inbox_guest_invites(email,created);
CREATE TABLE inbox_mail_preferences (
  email TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  disabled INTEGER NOT NULL DEFAULT 0,
  last_attempt INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE inbox_files (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  author TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 1048576),
  created INTEGER NOT NULL,
  post INTEGER UNIQUE REFERENCES inbox_posts(seq) ON DELETE CASCADE,
  PRIMARY KEY(room,author,nonce)
);
CREATE TRIGGER inbox_file_post AFTER INSERT ON inbox_files BEGIN
  INSERT INTO inbox_posts(room,author,nonce,kind,body,created)
    VALUES(NEW.room,NEW.author,NEW.nonce,'text',NEW.name,NEW.created);
  UPDATE inbox_files SET post=last_insert_rowid()
    WHERE room=NEW.room AND author=NEW.author AND nonce=NEW.nonce;
END;
