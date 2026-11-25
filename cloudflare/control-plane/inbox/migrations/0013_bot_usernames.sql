ALTER TABLE inbox_bots ADD COLUMN username TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX inbox_bot_username ON inbox_bots(username COLLATE NOCASE) WHERE username IS NOT NULL;
