CREATE TABLE inbox_uploads (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  author TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 20000000),
  created INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  post INTEGER UNIQUE REFERENCES inbox_posts(seq) ON DELETE CASCADE,
  UNIQUE(room,author,nonce)
);
CREATE INDEX inbox_upload_recent ON inbox_uploads(author,created);
CREATE INDEX inbox_upload_pending ON inbox_uploads(created) WHERE ready=0;
CREATE TABLE inbox_upload_parts (
  upload TEXT NOT NULL REFERENCES inbox_uploads(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(upload,part)
) WITHOUT ROWID;
CREATE TRIGGER inbox_publish_upload AFTER UPDATE OF ready ON inbox_uploads
WHEN OLD.ready=0 AND NEW.ready=1 BEGIN
  INSERT INTO inbox_posts(room,author,nonce,kind,body,created)
    VALUES(NEW.room,NEW.author,NEW.nonce,'text',NEW.name,NEW.created);
  UPDATE inbox_uploads SET post=last_insert_rowid() WHERE id=NEW.id;
END;
