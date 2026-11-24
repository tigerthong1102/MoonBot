import type { Message } from "./store.ts";

export function newestBranchLeaf(messages: readonly Message[], root: string): string {
  const newestChild = new Map<string, Message>();
  for (const message of messages) {
    if (typeof message.parentId !== "string") continue;
    const previous = newestChild.get(message.parentId);
    if (!previous || message.at >= previous.at) newestChild.set(message.parentId, message);
  }
  let leaf = root;
  for (;;) {
    const child = newestChild.get(leaf);
    if (!child) return leaf;
    leaf = child.id;
  }
}
