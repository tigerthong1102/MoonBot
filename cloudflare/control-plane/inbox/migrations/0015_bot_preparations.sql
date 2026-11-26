ALTER TABLE inbox_bots ADD COLUMN prepared_only INTEGER NOT NULL DEFAULT 0 CHECK(prepared_only IN (0, 1));
CREATE INDEX inbox_bot_owner_prepared ON inbox_bots(owner, prepared_only);
