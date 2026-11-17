import { createHash } from "node:crypto";

/** The eight hex characters that stand for one place in every address of its bots. */
export const placeKey = (placeId) => createHash("sha256").update(String(placeId)).digest("hex").slice(0, 8);

/** A bot's address in the other place: the place it lives in, and its id there. */
export const linkedAddress = (placeId, botId) => `link-${placeKey(placeId)}-${botId}`;
