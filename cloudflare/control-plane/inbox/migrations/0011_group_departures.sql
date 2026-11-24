CREATE TABLE inbox_group_departures (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY(room, person)
);

CREATE TRIGGER inbox_remember_group_departure AFTER DELETE ON inbox_members
WHEN EXISTS(SELECT 1 FROM inbox_rooms WHERE id=OLD.room AND kind='group' AND owner!=OLD.person)
  AND EXISTS(SELECT 1 FROM "user" WHERE id=OLD.person)
BEGIN
  INSERT OR IGNORE INTO inbox_group_departures(room,person) VALUES(OLD.room,OLD.person);
END;

CREATE TRIGGER inbox_direct_reciprocal_block BEFORE INSERT ON inbox_members
WHEN EXISTS(
  SELECT 1 FROM inbox_rooms r JOIN inbox_blocks b ON b.person=r.owner AND b.sender=NEW.person
  WHERE r.id=NEW.room AND r.kind='direct'
)
BEGIN
  SELECT RAISE(IGNORE);
END;
