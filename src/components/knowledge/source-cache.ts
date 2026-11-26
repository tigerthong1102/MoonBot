import { browserRecord } from "@/lib/browser-records";
import { apiFetch } from "@/state/api";
import { readSessionState } from "@/lib/session";
import type { Index } from "./source-index";

export async function libraryOwner(fetchImpl?: typeof fetch, reportOffline = false) {
  const session = await readSessionState(fetchImpl);
  if (reportOffline && session.kind === "unreachable") throw new TypeError("Source server unreachable");
  if (session.kind === "session") return session.id;
  if (session.kind === "loopback" && session.trust !== "service") return "local";
  return null;
}

const backgroundFetch: typeof fetch = (input, init) => apiFetch(input, { ...init, background: true, timeoutMs: 30_000 });

export async function libraryKey(threadId: string, options?: { reportOffline?: boolean; background?: boolean }) {
  const owner = await libraryOwner(options?.background ? backgroundFetch : undefined, options?.reportOffline);
  return owner ? JSON.stringify([owner, threadId]) : null;
}

export function readLibrary(key: string): Promise<Index | undefined> {
  return browserRecord("readonly", store => store.get(key));
}

export { sourceLink } from "../../../shared/source-evidence";

export function parseSourceLink(href: string) {
  const match = /^#startupbot-source-([0-9a-f]{64})-(\d{1,9})(?:\/([^\s#]{1,16384}))?$/.exec(href);
  if (!match) return null;
  try { return { digest: match[1]!, start: Number(match[2]), ...(match[3] ? { path: decodeURIComponent(match[3]) } : {}) }; }
  catch { return null; }
}
