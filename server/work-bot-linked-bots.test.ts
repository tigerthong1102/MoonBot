import { expect, it } from "vitest";
import { workBotsLinked } from "./work-bot-linked-bots.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";

it("recognizes transitive handoffs without joining unrelated bots", () => {
  const links: WorkBotLink[] = [
    { sourceBotId: "a", targetBotId: "b", sourceThreadId: "a-thread", targetThreadId: "b-thread", sourceMessageId: "one" },
    { sourceBotId: "b", targetBotId: "c", sourceThreadId: "b-thread", targetThreadId: "c-thread", sourceMessageId: "two" },
  ];
  const forBot = (id: string) => links.filter(link => link.sourceBotId === id || link.targetBotId === id);
  expect(workBotsLinked("a", "c", forBot)).toBe(true);
  expect(workBotsLinked("c", "a", forBot)).toBe(true);
  expect(workBotsLinked("a", "d", forBot)).toBe(false);
});
