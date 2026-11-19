-- Better Auth 1.7.7, email OTP and database-backed rate limits.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

-- A recipient-scoped limit complements Better Auth's IP limits so distributed
-- callers cannot repeatedly rotate and send codes to one email address.
-- Recipient keys are HMACs, never plaintext addresses.
CREATE TABLE otp_recipient_rate_limits (
  recipient_key TEXT PRIMARY KEY CHECK (length(recipient_key) = 64),
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  updated_at INTEGER NOT NULL
);

CREATE INDEX otp_recipient_rate_limits_updated_idx
  ON otp_recipient_rate_limits(updated_at);

-- Per-account limits on creating rooms, inviting members and posting.
CREATE TABLE control_action_rate_limits (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, action)
);
