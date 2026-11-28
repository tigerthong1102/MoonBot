import { readFileSync } from "node:fs";

const migrations = new URL("../../cloudflare/control-plane/migrations/", import.meta.url);
const files = [
  "0002_installations.sql",
  "0003_otp_recipient_rate_limits.sql",
  "0016_installation_kind.sql",
  "0019_mobile_desktop_drafts.sql",
  "0020_mobile_receiver_grants.sql",
];

// Only issuer IDs and expiry anchor the original installation and draft foreign keys.
export function pilotHandoffSchema() {
  return [
    "CREATE TABLE user(id TEXT PRIMARY KEY);",
    "CREATE TABLE session(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id), expires INTEGER NOT NULL);",
    ...files.map(file => readFileSync(new URL(file, migrations), "utf8")),
    "CREATE TABLE installation_push_devices(installation_id TEXT REFERENCES installations(id) ON DELETE CASCADE);",
  ].join("\n");
}
