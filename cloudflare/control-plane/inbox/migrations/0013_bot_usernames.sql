ALTER TABLE inbox_bots ADD COLUMN username TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX inbox_bot_username ON inbox_bots(username COLLATE NOCASE) WHERE username IS NOT NULL;
CREATE TABLE inbox_bot_claims (
 nonce TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, bot TEXT NOT NULL,
 room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE, expires INTEGER NOT NULL
);
CREATE INDEX inbox_bot_claim_owner_expiry ON inbox_bot_claims(owner,expires);
