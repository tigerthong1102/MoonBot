ALTER TABLE inbox_guest_invites ADD COLUMN sender TEXT REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE inbox_members ADD COLUMN admin INTEGER NOT NULL DEFAULT 0 CHECK(admin IN (0,1));
ALTER TABLE inbox_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1));
ALTER TABLE inbox_rooms ADD COLUMN approval INTEGER NOT NULL DEFAULT 1 CHECK(approval IN (0,1));
ALTER TABLE inbox_rooms ADD COLUMN announcements INTEGER NOT NULL DEFAULT 0 CHECK(announcements IN (0,1));
ALTER TABLE inbox_rooms ADD COLUMN invite_key TEXT;
ALTER TABLE inbox_rooms ADD COLUMN invite_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_rooms ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX inbox_group_link ON inbox_rooms(invite_key) WHERE invite_key IS NOT NULL;
CREATE TABLE inbox_group_requests (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY(room,person)
);
CREATE TABLE inbox_group_bans (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY(room,person)
);
CREATE TRIGGER inbox_ban_member BEFORE INSERT ON inbox_members
WHEN EXISTS(SELECT 1 FROM inbox_group_bans WHERE room=NEW.room AND person=NEW.person)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER inbox_group_banned AFTER INSERT ON inbox_group_bans BEGIN
  DELETE FROM inbox_members WHERE room=NEW.room AND person=NEW.person;
  DELETE FROM inbox_group_requests WHERE room=NEW.room AND person=NEW.person;
  UPDATE inbox_rooms SET revision=revision+1 WHERE id=NEW.room;
END;
CREATE TRIGGER inbox_group_admitted AFTER INSERT ON inbox_members BEGIN
  DELETE FROM inbox_group_requests WHERE room=NEW.room AND person=NEW.person;
  UPDATE inbox_rooms SET revision=revision+1 WHERE id=NEW.room;
END;
CREATE TRIGGER inbox_group_member_change AFTER UPDATE ON inbox_members BEGIN
  UPDATE inbox_rooms SET revision=revision+1 WHERE id=NEW.room;
END;
CREATE TRIGGER inbox_group_member_leave AFTER DELETE ON inbox_members BEGIN
  UPDATE inbox_rooms SET revision=revision+1 WHERE id=OLD.room;
END;
CREATE TRIGGER inbox_group_post_removed AFTER DELETE ON inbox_posts BEGIN
  UPDATE inbox_rooms SET revision=revision+1 WHERE id=OLD.room;
END;
CREATE TRIGGER inbox_group_request_added AFTER INSERT ON inbox_group_requests BEGIN
  UPDATE inbox_rooms SET revision=revision+1 WHERE id=NEW.room;
END;
CREATE TRIGGER inbox_group_request_removed AFTER DELETE ON inbox_group_requests BEGIN
  UPDATE inbox_rooms SET revision=revision+1 WHERE id=OLD.room;
END;
CREATE TRIGGER inbox_group_key_change AFTER UPDATE OF invite_key ON inbox_rooms BEGIN
  DELETE FROM inbox_group_requests WHERE room=NEW.id;
END;
CREATE TRIGGER inbox_group_owner_change AFTER UPDATE OF owner ON inbox_rooms WHEN OLD.owner!=NEW.owner BEGIN
  UPDATE inbox_members SET admin=1 WHERE room=NEW.id AND person=OLD.owner;
  UPDATE inbox_members SET admin=0,muted=0 WHERE room=NEW.id AND person=NEW.owner;
END;
CREATE TABLE inbox_group_mutes (
  room TEXT NOT NULL REFERENCES inbox_rooms(id) ON DELETE CASCADE,
  person TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY(room,person)
);
CREATE TRIGGER inbox_remember_restriction AFTER UPDATE OF muted ON inbox_members WHEN NEW.muted!=OLD.muted BEGIN
  INSERT OR IGNORE INTO inbox_group_mutes SELECT NEW.room,NEW.person WHERE NEW.muted=1;
  DELETE FROM inbox_group_mutes WHERE room=NEW.room AND person=NEW.person AND NEW.muted=0;
END;
CREATE TRIGGER inbox_restore_restriction AFTER INSERT ON inbox_members
WHEN EXISTS(SELECT 1 FROM inbox_group_mutes WHERE room=NEW.room AND person=NEW.person) BEGIN
  UPDATE inbox_members SET muted=1 WHERE room=NEW.room AND person=NEW.person;
END;
