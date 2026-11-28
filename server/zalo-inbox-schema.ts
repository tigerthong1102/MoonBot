import { z } from "zod";

const id = z.string().min(1).max(256).regex(/^\P{C}+$/u).refine(value => !/\s/u.test(value));
export const zaloScope = z.object({
  adapter: z.enum(["official", "personal", "manual"]), accountId: id, conversationId: id,
  conversationType: z.enum(["direct", "group"]), senderId: id,
});
export const zaloGrantInput = zaloScope.extend({ retentionDays: z.number().int().min(1).max(365) });
export const zaloEventInput = zaloScope.extend({
  messageId: id, timestamp: z.number().int().positive().max(8_640_000_000_000_000),
  text: z.string().min(1).max(8000), direction: z.enum(["incoming", "outgoing"]),
});
export const zaloInboxSchema = `
  PRAGMA foreign_keys = ON;
  PRAGMA secure_delete = ON;
  CREATE TABLE IF NOT EXISTS zalo_grants (
    grantId TEXT PRIMARY KEY, adapter TEXT NOT NULL, accountId TEXT NOT NULL, conversationId TEXT NOT NULL,
    conversationType TEXT NOT NULL, senderId TEXT NOT NULL, since INTEGER NOT NULL, retentionDays INTEGER NOT NULL,
    lastPoll INTEGER, UNIQUE(adapter, accountId, conversationId, conversationType, senderId)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS zalo_one_official_pair ON zalo_grants(accountId) WHERE adapter = 'official';
  CREATE TABLE IF NOT EXISTS zalo_events (
    grantId TEXT NOT NULL REFERENCES zalo_grants ON DELETE CASCADE, adapter TEXT NOT NULL, accountId TEXT NOT NULL,
    conversationId TEXT NOT NULL, conversationType TEXT NOT NULL, messageId TEXT NOT NULL, timestamp INTEGER NOT NULL, text TEXT NOT NULL,
    direction TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(adapter, accountId, conversationId, conversationType, messageId)
  );
  CREATE INDEX IF NOT EXISTS zalo_events_scope_time ON zalo_events(grantId, timestamp, messageId);
  CREATE INDEX IF NOT EXISTS zalo_events_expiry ON zalo_events(expires);
  CREATE TABLE IF NOT EXISTS zalo_erased_ranges (
    grantId TEXT NOT NULL REFERENCES zalo_grants ON DELETE CASCADE, start INTEGER NOT NULL, end INTEGER NOT NULL,
    expires INTEGER NOT NULL, PRIMARY KEY(grantId, start, end)
  );
  CREATE INDEX IF NOT EXISTS zalo_erased_expiry ON zalo_erased_ranges(expires);
  CREATE TABLE IF NOT EXISTS zalo_webhook_endpoints (
    endpoint TEXT PRIMARY KEY, accountId TEXT NOT NULL UNIQUE, secretHash BLOB NOT NULL UNIQUE,
    grantId TEXT REFERENCES zalo_grants(grantId) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS zalo_poll_leases (
    accountId TEXT PRIMARY KEY, lease TEXT NOT NULL UNIQUE, grantedTo TEXT NOT NULL, started INTEGER NOT NULL, until INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS zalo_poll_gaps (
    grantId TEXT NOT NULL REFERENCES zalo_grants ON DELETE CASCADE, start INTEGER NOT NULL, end INTEGER NOT NULL,
    expires INTEGER NOT NULL, PRIMARY KEY(grantId, start, end)
  );
  CREATE INDEX IF NOT EXISTS zalo_gap_expiry ON zalo_poll_gaps(expires);
`;
