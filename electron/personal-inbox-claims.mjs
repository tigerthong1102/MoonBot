const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export const identityScope = "00000000-0000-4000-8000-000000000000";

export function createPersonalInboxClaims(cloud) {
  const endpoint = room => {
    if (typeof room !== "string" || !uuid.test(room)) throw new Error("invalid_room");
    return `rooms/${room}/bots`;
  };
  return {
    identityChallenge({ bot }) { return cloud("bot-identities", { action: "challenge", bot }); },
    registerIdentity({ bot, name, username, proof }) { return cloud("bot-identities", { action: "register", bot, name, username, proof }); },
    inviteLegacy({ room, owner, bot, name }) {
      return cloud(endpoint(room), { action: "invite", owner, bot, name });
    },
    challenge({ room, owner, bot }) {
      return cloud(endpoint(room), { action: "challenge", owner, bot });
    },
    invite({ room, owner, bot, name, username, proof }) {
      return cloud(endpoint(room), { action: "invite", owner, bot, name, username, proof });
    },
  };
}
