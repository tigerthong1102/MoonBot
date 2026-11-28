-- A foreground, empty Desktop composer advertises a short-lived, opt-in destination.
CREATE TABLE mobile_draft_receivers (
  installation TEXT PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  listener TEXT NOT NULL, public_key TEXT NOT NULL, credential TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE mobile_desktop_drafts (
  owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, session TEXT NOT NULL REFERENCES "session"(id) ON DELETE CASCADE,
  installation TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  listener TEXT NOT NULL, fingerprint TEXT NOT NULL, envelope TEXT,
  state TEXT NOT NULL CHECK(state IN ('offered','claimed','received')),
  created INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(owner,id)
);
CREATE INDEX mobile_desktop_drafts_expiry ON mobile_desktop_drafts(expires);
CREATE INDEX mobile_desktop_drafts_destination ON mobile_desktop_drafts(installation,listener,state);
