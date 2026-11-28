export function exactGrantMessage({
  origin,
  owner,
  pairing,
  id,
  twin,
  revision,
  lesson,
  question,
  answer,
  rooms,
  expires,
}) {
  return JSON.stringify([
    "startupbot.inbox.exact-release",
    1,
    "one-lesson",
    "no-provider",
    origin,
    owner,
    pairing,
    id,
    twin,
    revision,
    lesson,
    question,
    answer,
    rooms,
    expires,
    20,
  ]);
}
export function exactPostMessage({ origin, owner, pairing, id, source, room, nonce, expires }) {
  return JSON.stringify([
    "startupbot.inbox.exact-post",
    1,
    origin,
    owner,
    pairing,
    id,
    source,
    room,
    nonce,
    expires,
  ]);
}
