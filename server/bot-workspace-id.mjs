import { randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function readId(file) {
  let fd;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 4096) throw new Error("Workspace identity is unavailable");
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const value = JSON.parse(readFileSync(fd, "utf8"));
    if (value?.version !== 1 || typeof value.id !== "string" || !uuid.test(value.id)) throw new Error("Workspace identity is invalid");
    return value.id.toLowerCase();
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

// Security invariant: the single registry-owner event loop runs this synchronously while the guard prevents restore.
export function createBotWorkspaceIdStore({ directory, hasAnchoredBots, acquireOwnerGuard }) {
  const file = join(directory, "bot-workspace-identity.json");
  return {
    loadOrCreate() {
      if (typeof acquireOwnerGuard !== "function") throw new Error("Workspace identity guard is unavailable");
      const lock = acquireOwnerGuard();
      if (!lock || lock.held !== true || typeof lock.release !== "function") {
        if (lock && typeof lock.then === "function") Promise.resolve(lock).catch(() => {});
        throw new Error("Workspace identity guard is unavailable");
      }
      let result, failure;
      try {
        result = (() => {
          const anchored = hasAnchoredBots();
          if (anchored !== true && anchored !== false) {
            if (anchored && typeof anchored.then === "function") Promise.resolve(anchored).catch(() => {});
            throw new Error("Workspace identity is unavailable; restore it before continuing");
          }
          const found = readId(file);
          if (found) return found;
          if (anchored) throw new Error("Workspace identity is missing; restore it before continuing");
          mkdirSync(directory, { recursive: true, mode: 0o700 });
          const temporary = `${file}.${randomUUID()}.tmp`;
          let failure;
          try {
            const fd = openSync(temporary, "wx", 0o600);
            try { writeFileSync(fd, JSON.stringify({ version: 1, id: randomUUID() })); fsyncSync(fd); } finally { closeSync(fd); }
            linkSync(temporary, file);
          } catch (error) { failure = error; }
          try { unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT" && !failure) failure = error; }
          if (failure && failure.code !== "EEXIST") throw failure;
          const saved = readId(file);
          if (!saved) throw new Error("Workspace identity is unavailable");
          return saved;
        })();
      } catch (error) { failure = error; }
      try {
        const released = lock.release();
        if (released && typeof released.then === "function") {
          Promise.resolve(released).catch(() => {});
          throw new Error("Workspace identity guard must release synchronously");
        }
      } catch (error) { failure ??= error; }
      if (failure) throw failure;
      return result;
    },
  };
}
