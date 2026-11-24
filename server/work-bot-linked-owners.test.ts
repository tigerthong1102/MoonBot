import { expect, it } from "vitest";
import { linkedWorkBotOwners } from "./work-bot-linked-owners.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";

it("finds both direct and sibling bots through links without looping or accepting unrelated rows", () => {
  const link = (sourceBotId: string, targetBotId: string): WorkBotLink => ({ sourceBotId, targetBotId, sourceThreadId: `${sourceBotId}-thread`, sourceMessageId: `${sourceBotId}-${targetBotId}`, targetThreadId: `${targetBotId}-thread` });
  const links = [link("main", "first"), link("main", "second"), link("second", "third"), link("third", "main"), link("unrelated", "other")];
  const owners = linkedWorkBotOwners("first", bot => links.filter(item => item.sourceBotId === bot || item.targetBotId === bot).concat(link("wrong", "other")));
  expect([...owners].sort()).toEqual(["main", "second", "third"]);
});
