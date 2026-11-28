-- Only an authenticated account session can arm a foreground receiver. An old
-- heartbeat carries no account grant and cannot authorize a new listener.
DELETE FROM mobile_draft_receivers;
ALTER TABLE mobile_draft_receivers ADD COLUMN account_session TEXT REFERENCES "session"(id) ON DELETE CASCADE;
ALTER TABLE mobile_draft_receivers ADD COLUMN grant_expires INTEGER NOT NULL DEFAULT 0;
