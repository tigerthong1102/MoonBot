import { visibleMessages, type Bot, type Group } from "@/state/store";
import type { SearchHit } from "./search-hit";

export type WorkspaceTarget =
  | { kind: "task"; name: string; owner: string; id: string; threadId: string; group: boolean }
  | { kind: "report"; name: string; owner: string; hit: SearchHit };

export function workspaceTargets(bots: Bot[], groups: Group[]): WorkspaceTarget[] {
  const targets: WorkspaceTarget[] = [];
  for (const owner of [...bots.filter(bot => !bot.hidden), ...groups]) {
    const group = "memberIds" in owner;
    for (const task of owner.tasks ?? []) {
      if (task.title && !task.archivedAt) targets.push({ kind: "task", name: task.title, owner: owner.name, id: owner.id, threadId: task.threadId, group });
    }
    if (group) continue;
    for (const message of visibleMessages(owner)) {
      const page = message.publishedPage;
      const name = page?.state === "live" && page.url ? page.title || page.url : message.kind === "app" ? message.app?.title : undefined;
      if (!name) continue;
      targets.push({ kind: "report", name, owner: owner.name, hit: { botId: owner.id, name: owner.name, threadId: owner.threadId,
        messageId: message.id, at: message.at, role: message.role, kind: message.kind, snippet: name, matchStart: 0, matchLength: 0, onActivePath: true } });
    }
  }
  return targets;
}
