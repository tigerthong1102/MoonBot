export const generatedRoomLimit = 8;

export function generatedGrantMessage({ origin, owner, pairing, id, twin, revision, rooms, expires, provider }) {
  return JSON.stringify([
    "startupbot.inbox.generated-release", generatedRoomKinds(rooms).length ? 2 : 1, origin, owner, pairing, id, twin, revision, rooms, expires,
    provider.key, provider.name, provider.model, provider.destination, 5, "current-message-only",
  ]);
}

export function generatedPostMessage({ origin, owner, pairing, id, source, room, nonce, expires, inputHash, answer, rooms, kind }) {
  if (generatedRoomKinds(rooms).length) {
    return JSON.stringify(["startupbot.inbox.generated-post", 2, origin, owner, pairing, id, source, room, kind, nonce, expires, inputHash, answer]);
  }
  return JSON.stringify(["startupbot.inbox.generated-post", 1, origin, owner, pairing, id, source, room, nonce, expires, inputHash, answer]);
}

export function generatedRoomKinds(rooms) {
  if (!Array.isArray(rooms) || !rooms.length || rooms.length > 2 || new Set(rooms).size !== rooms.length ||
      !rooms.every(ref => ref === "all-direct" || ref === "all-managed-groups")) return [];
  return rooms.map(ref => ref === "all-direct" ? "direct" : "group");
}
