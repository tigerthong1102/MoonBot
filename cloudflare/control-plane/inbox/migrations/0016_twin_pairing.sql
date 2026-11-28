CREATE TABLE inbox_twin_pairings (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  desktop_session TEXT NOT NULL REFERENCES "session"(id) ON DELETE CASCADE,
  review_session TEXT REFERENCES "session"(id) ON DELETE CASCADE,
  inbox_session TEXT REFERENCES "session"(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  twin TEXT NOT NULL,
  revision INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  signed INTEGER NOT NULL DEFAULT 0 CHECK (signed IN (0,1)),
  CHECK (inbox_session IS NULL OR (signed=1 AND inbox_session!=desktop_session))
);
CREATE INDEX inbox_twin_pairings_owner ON inbox_twin_pairings(owner);
CREATE INDEX inbox_twin_pairings_expiry ON inbox_twin_pairings(expires);
