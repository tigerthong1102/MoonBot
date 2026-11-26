import { expect, it } from "vitest";
import { registeredBotUsernames } from "./bot-username.ts";

it("exposes only unique and valid registered usernames", () => {
  const first = `bot_k${"a".repeat(64)}`, second = `bot_k${"b".repeat(64)}`;
  const bots = [{ id: "one", groupUsername: first }, { id: "two", groupUsername: second }, { id: "legacy" }, { id: "invalid", groupUsername: "bot_u123" }];
  expect([...registeredBotUsernames(bots)]).toEqual([["one", first], ["two", second]]);
  expect([...registeredBotUsernames([...bots, { id: "duplicate", groupUsername: first }])]).toEqual([["two", second]]);
});
