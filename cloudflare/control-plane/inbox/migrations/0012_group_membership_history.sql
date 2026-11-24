ALTER TABLE inbox_rooms ADD COLUMN membership_history_complete INTEGER NOT NULL DEFAULT 0
  CHECK(membership_history_complete IN (0,1));
