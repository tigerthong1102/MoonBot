export function generatedGrantMessage({ origin, owner, pairing, id, twin, revision, rooms, expires, provider }) {
  return JSON.stringify([
    "startupbot.inbox.generated-release", 1, origin, owner, pairing, id, twin, revision, rooms, expires,
    provider.key, provider.name, provider.model, provider.destination, 5, "current-message-only",
  ]);
}

export function generatedPostMessage({ origin, owner, pairing, id, source, room, nonce, expires, inputHash, answer }) {
  return JSON.stringify(["startupbot.inbox.generated-post", 1, origin, owner, pairing, id, source, room, nonce, expires, inputHash, answer]);
}
