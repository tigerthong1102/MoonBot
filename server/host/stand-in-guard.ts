// Linked bots are read-only here; mutation requests must not create or alter local state.
import { botMoveRefusal } from "../bot-moves.ts";

type StandIn = { name: string; home?: { place: string; placeName: string; botId: string } };

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const decoded = (value: string): string => { try { return decodeURIComponent(value); } catch { return value; } };

/** The stand-in a request that changes something names in its path or its query, if any. With no stand-in on this place
 * (the link is off) this looks at nothing. The link's own routes are not bot routes and are left to the link. */
export function standInNamed(standIns: ReadonlyMap<string, StandIn>, method: string, url: URL): StandIn | null {
  if (standIns.size === 0 || READS.has(method)) return null;
  const path = url.pathname;
  if (!path.startsWith("/api/") || path === "/api/bot-link" || path.startsWith("/api/bot-link/")) return null;
  for (const segment of path.split("/")) {
    const named = segment ? standIns.get(decoded(segment)) : undefined;
    if (named) return named;
  }
  for (const value of url.searchParams.values()) {
    const named = standIns.get(value);
    if (named) return named;
  }
  return null;
}

/** The answer such a request gets: where the bot lives, in the words a turn for it is refused with. */
export function standInWriteRefusal(standIns: ReadonlyMap<string, StandIn>, method: string, url: URL): { error: string; code: "moved" } | null {
  const named = standInNamed(standIns, method, url);
  return named ? { error: botMoveRefusal(named) ?? `${named.name} lives in another place.`, code: "moved" } : null;
}

/** The first stand-in among ids a request's body names (a room's members, an automation's bot), or null. */
export function standInAmong(standIns: ReadonlyMap<string, StandIn>, ids: readonly unknown[]): { error: string } | null {
  if (standIns.size === 0) return null;
  for (const id of ids) {
    const named = typeof id === "string" ? standIns.get(id) : undefined;
    if (named) return { error: botMoveRefusal(named) ?? `${named.name} lives in another place.` };
  }
  return null;
}
