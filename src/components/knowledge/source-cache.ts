import { browserRecord } from "@/lib/browser-records";
import { readSessionState } from "@/lib/session";
import type { Index } from "./source-index";

export async function libraryOwner() {
  const session = await readSessionState();
  if (session.kind === "session") return session.id;
  if (session.kind === "loopback" && session.trust !== "service") return "local";
  return null;
}

export async function libraryKey(threadId: string) {
  const owner = await libraryOwner();
  return owner ? JSON.stringify([owner, threadId]) : null;
}

export function readLibrary(key: string): Promise<Index | undefined> {
  return browserRecord("readonly", store => store.get(key));
}

export function sourceLink(digest: string, start: number, path: string) {
  const name = encodeURIComponent(path).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16));
  return "#startupbot-source-" + digest + "-" + start + "/" + name;
}

export function parseSourceLink(href: string) {
  const match = /^#startupbot-source-([0-9a-f]{64})-(\d{1,9})(?:\/([^\s#]{1,16384}))?$/.exec(href);
  if (!match) return null;
  try { return { digest: match[1]!, start: Number(match[2]), ...(match[3] ? { path: decodeURIComponent(match[3]) } : {}) }; }
  catch { return null; }
}
