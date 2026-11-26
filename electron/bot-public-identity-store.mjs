import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function identityValid(value) {
  if (!value || typeof value.publicKey !== "string" || !/^[a-f0-9]{64}$/.test(value.publicKey)) return false;
  return value.username === `bot_k${createHash("sha256").update(Buffer.from(value.publicKey, "hex")).digest("hex")}`;
}

function readRecord(file, botId, workspaceId) {
  let fd;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 4096) throw new Error("Bot identity record is unavailable");
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const row = JSON.parse(readFileSync(fd, "utf8"));
    if (row.botId !== botId || row.workspaceId !== workspaceId || !identityValid(row)) throw new Error("Bot identity record is invalid");
    return row;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

function createRecord(file, row) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let failure;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(row)); fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(temporary, file);
  } catch (error) { failure = error; }
  try { unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT" && !failure) failure = error; }
  if (failure && failure.code !== "EEXIST") throw failure;
}

export function createBotPublicIdentityStore({ directory, workspaceId, current }) {
  function fileFor(scope) {
    if (!scope || scope.workspaceId !== workspaceId || current(scope) !== true || typeof scope.localBotId !== "string" || !scope.localBotId || scope.localBotId.length > 512) throw new Error("target_changed");
    return join(directory, `${createHash("sha256").update(JSON.stringify([workspaceId, scope.localBotId]), "utf8").digest("hex")}.json`);
  }
  return {
    async load(scope) {
      const record = readRecord(fileFor(scope), scope.localBotId, workspaceId);
      return record ? { kind: "existing", username: record.username } : { kind: "new" };
    },
    async commit(scope, expected, identity) {
      const file = fileFor(scope);
      if (!identityValid(identity) || !expected || (expected.kind !== "new" && expected.kind !== "existing")) throw new Error("identity_state_unavailable");
      const existing = readRecord(file, scope.localBotId, workspaceId);
      if (!existing && expected.kind === "existing") throw new Error("Bot identity record is missing; restore it before continuing");
      if (!existing) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        createRecord(file, { workspaceId, botId: scope.localBotId, username: identity.username, publicKey: identity.publicKey });
      }
      const saved = readRecord(file, scope.localBotId, workspaceId);
      if (!saved || saved.username !== identity.username || saved.publicKey !== identity.publicKey || (expected.kind === "existing" && expected.username !== saved.username)) throw new Error("identity_changed");
      return { kind: "existing", username: saved.username };
    },
  };
}
