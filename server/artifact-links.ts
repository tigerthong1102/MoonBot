import { randomBytes } from "node:crypto";
import { mediaViewerKey } from "./message-media-links.ts";
import type { RequestAuth } from "./request-auth.ts";

interface Link { threadId: string; messageId: string; path: string; owner: string; expiresAt: number }

export class ArtifactLinks {
  private readonly links = new Map<string, Link>();
  private readonly now: () => number;
  constructor(now = Date.now) { this.now = now; }

  issue(threadId: string, messageId: string, path: string, auth: RequestAuth) {
    const owner = mediaViewerKey(auth);
    const now = this.now();
    for (const [id, link] of this.links) {
      if (link.expiresAt <= now) this.links.delete(id);
      else if (link.threadId === threadId && link.messageId === messageId && link.path === path && link.owner === owner) return { id, expiresAt: link.expiresAt };
    }
    const id = randomBytes(32).toString("base64url");
    const expiresAt = now + 24 * 60 * 60_000;
    if (this.links.size >= 2048) this.links.delete(this.links.keys().next().value!);
    this.links.set(id, { threadId, messageId, path, owner, expiresAt });
    return { id, expiresAt };
  }

  read(id: string, threadId: string, messageId: string) {
    const link = this.links.get(id);
    return link && link.expiresAt > this.now() && link.threadId === threadId && link.messageId === messageId ? link.path : null;
  }

  revoke(id: string, threadId: string, messageId: string, auth: RequestAuth) {
    const link = this.links.get(id);
    if (link?.owner === mediaViewerKey(auth) && link.threadId === threadId && link.messageId === messageId) this.links.delete(id);
  }
}
