export function twinPairingMessage({ origin, owner, id, publicKey, twin, revision, expires }) {
  return JSON.stringify([
    "startupbot.inbox.desktop-key-confirmation",
    1,
    origin,
    owner,
    id,
    publicKey,
    twin,
    revision,
    expires,
  ]);
}
