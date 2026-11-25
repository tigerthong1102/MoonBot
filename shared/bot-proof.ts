export interface BotClaim {
  origin: string;
  owner: string;
  bot: string;
  room: string;
  nonce: string;
}

function claimBytes(claim: BotClaim): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(["startupbot-inbox-bot-claim-v1", claim.origin, claim.owner, claim.bot, claim.room, claim.nonce]));
}

export async function proofUsername(publicKey: Uint8Array): Promise<string> {
  if (publicKey.length !== 32) throw new Error("Invalid bot public key");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(publicKey)));
  return `bot_k${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function botClaimBytes(claim: BotClaim): Uint8Array {
  if (![claim.origin, claim.owner, claim.bot, claim.room, claim.nonce].every(value => typeof value === "string" && value.length > 0 && value.length <= 512)) throw new Error("Invalid bot claim");
  return claimBytes(claim);
}

export async function verifyBotClaim(publicKey: Uint8Array, username: string, claim: BotClaim, signature: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64 || !/^bot_k[a-f0-9]{64}$/.test(username)) return false;
  try {
    const publicKeyCopy = new Uint8Array(publicKey), signatureCopy = new Uint8Array(signature);
    const claimCopy = { origin: claim.origin, owner: claim.owner, bot: claim.bot, room: claim.room, nonce: claim.nonce };
    const payload = new Uint8Array(botClaimBytes(claimCopy));
    if (await proofUsername(publicKeyCopy) !== username) return false;
    const key = await crypto.subtle.importKey("raw", publicKeyCopy, "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, signatureCopy, payload);
  } catch { return false; }
}
