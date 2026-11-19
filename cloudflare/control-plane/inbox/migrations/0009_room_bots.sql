CREATE TABLE inbox_bots (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, name TEXT NOT NULL
);
CREATE INDEX inbox_bot_owner ON inbox_bots(owner);
CREATE TABLE inbox_room_bots (
 room TEXT NOT NULL, bot TEXT NOT NULL REFERENCES inbox_bots(id) ON DELETE CASCADE,
 owner TEXT NOT NULL, PRIMARY KEY(room,bot),
 FOREIGN KEY(room,owner) REFERENCES inbox_members(room,person) ON DELETE CASCADE
);
CREATE TABLE inbox_bot_rounds (
 id TEXT PRIMARY KEY, room TEXT NOT NULL UNIQUE, first_bot TEXT NOT NULL, second_bot TEXT NOT NULL,
 starter TEXT NOT NULL, topic TEXT NOT NULL, locale TEXT NOT NULL, prior TEXT,
 prior_seq INTEGER REFERENCES inbox_posts(seq) ON DELETE CASCADE,
 step INTEGER NOT NULL DEFAULT 0, claim TEXT, expires INTEGER NOT NULL,
 FOREIGN KEY(room,first_bot) REFERENCES inbox_room_bots(room,bot) ON DELETE CASCADE,
 FOREIGN KEY(room,second_bot) REFERENCES inbox_room_bots(room,bot) ON DELETE CASCADE,
 FOREIGN KEY(room,starter) REFERENCES inbox_members(room,person) ON DELETE CASCADE
);
ALTER TABLE inbox_posts ADD COLUMN bot_name TEXT;
CREATE TRIGGER inbox_bot_topic_removed AFTER DELETE ON inbox_posts BEGIN
 DELETE FROM inbox_bot_rounds WHERE room=OLD.room AND id=OLD.nonce AND starter=OLD.author;
END;
CREATE TRIGGER inbox_bot_added AFTER INSERT ON inbox_room_bots BEGIN
 UPDATE inbox_rooms SET revision=revision+1 WHERE id=NEW.room;
END;
CREATE TRIGGER inbox_bot_removed AFTER DELETE ON inbox_room_bots BEGIN
 UPDATE inbox_rooms SET revision=revision+1 WHERE id=OLD.room;
END;
CREATE TRIGGER inbox_bot_round_start AFTER INSERT ON inbox_bot_rounds BEGIN
 UPDATE inbox_rooms SET revision=revision+1 WHERE id=NEW.room;
END;
CREATE TRIGGER inbox_bot_round_failed AFTER UPDATE OF step ON inbox_bot_rounds WHEN NEW.step=-1 BEGIN
 UPDATE inbox_rooms SET revision=revision+1 WHERE id=NEW.room;
END;
CREATE TRIGGER inbox_bot_round_stop AFTER DELETE ON inbox_bot_rounds BEGIN
 UPDATE inbox_rooms SET revision=revision+1 WHERE id=OLD.room;
END;
CREATE TABLE inbox_bot_usage (
 bot TEXT PRIMARY KEY REFERENCES inbox_bots(id) ON DELETE CASCADE, window_start INTEGER NOT NULL, turns INTEGER NOT NULL
);
