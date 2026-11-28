DROP TRIGGER inbox_generated_activate;
CREATE TRIGGER inbox_generated_activate AFTER UPDATE OF after_seq ON inbox_generated_grants
  WHEN OLD.after_seq IS NULL AND NEW.after_seq IS NOT NULL BEGIN
  INSERT INTO inbox_generated_rooms(room,grant_id) SELECT substr(value,1,36),NEW.id FROM json_each(NEW.rooms)
    WHERE value NOT IN ('all-direct','all-managed-groups');
END;

CREATE TABLE inbox_generated_disclosures (
  token TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES inbox_generated_grants(id) ON DELETE CASCADE,
  room TEXT NOT NULL, viewer TEXT NOT NULL,
  FOREIGN KEY(room,viewer) REFERENCES inbox_members(room,person) ON DELETE CASCADE,
  UNIQUE(grant_id,room,viewer)
);
CREATE TRIGGER inbox_generated_disclosure_member AFTER UPDATE OF state,muted ON inbox_members
  WHEN OLD.state!=NEW.state OR OLD.muted!=NEW.muted BEGIN
  DELETE FROM inbox_generated_disclosures WHERE room=NEW.room AND viewer=NEW.person;
END;
CREATE TRIGGER inbox_generated_disclosure_block AFTER INSERT ON inbox_blocks BEGIN
  DELETE FROM inbox_generated_disclosures WHERE
    (viewer=NEW.sender AND grant_id IN (SELECT id FROM inbox_generated_grants WHERE owner=NEW.person)) OR
    (viewer=NEW.person AND grant_id IN (SELECT id FROM inbox_generated_grants WHERE owner=NEW.sender));
END;
CREATE TRIGGER inbox_generated_bound_manager_changed AFTER UPDATE OF state,muted,admin ON inbox_members
  WHEN (OLD.state='active' AND NEW.state!='active') OR (OLD.muted=0 AND NEW.muted!=0)
    OR (OLD.admin=1 AND NEW.admin=0 AND EXISTS(SELECT 1 FROM inbox_rooms WHERE id=NEW.room AND kind='group' AND owner!=NEW.person)) BEGIN
  DELETE FROM inbox_generated_grants WHERE owner=NEW.person AND id IN (SELECT grant_id FROM inbox_generated_rooms WHERE room=NEW.room);
END;
CREATE TRIGGER inbox_generated_bound_manager_removed AFTER DELETE ON inbox_members BEGIN
  DELETE FROM inbox_generated_grants WHERE owner=OLD.person AND id IN (SELECT grant_id FROM inbox_generated_rooms WHERE room=OLD.room);
END;
CREATE TRIGGER inbox_generated_bound_manager_transferred AFTER UPDATE OF owner ON inbox_rooms
  WHEN OLD.owner!=NEW.owner AND OLD.kind='group' AND NOT EXISTS(
    SELECT 1 FROM inbox_members WHERE room=NEW.id AND person=OLD.owner AND state='active' AND muted=0 AND admin=1
  ) BEGIN
  DELETE FROM inbox_generated_grants WHERE owner=OLD.owner AND id IN (SELECT grant_id FROM inbox_generated_rooms WHERE room=NEW.id);
END;
