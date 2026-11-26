CREATE TABLE inbox_bot_identity_claims (
 nonce TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 bot TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX inbox_bot_identity_claim_owner ON inbox_bot_identity_claims(owner,expires);
