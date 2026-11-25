import { expect, it } from "vitest";
import { botUsername, maskPickedBotUsernames } from "./bot-username.ts";

it("derives stable distinct handles from bot IDs, including legacy IDs", () => {
  const ids = ["a", "A", "a-b", "ab", "b", "𐀀", "\ud800", "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const handles = ids.map(botUsername);
  expect(new Set(handles).size).toBe(ids.length);
  expect(handles.every(handle => /^bot_[a-z0-9]+$/.test(handle))).toBe(true);
  expect(botUsername(ids[0]!)).toBe(handles[0]);
});

it("masks only usernames belonging to explicitly selected bot IDs", () => {
  const tag = `@${botUsername("a")}`;
  const text = `${tag} private details; @Bob please help`;
  expect(maskPickedBotUsernames(text, ["a"])).toBe(`${" ".repeat(tag.length)} private details; @Bob please help`);
  expect(maskPickedBotUsernames(text, ["other"])).toBe(text);
});
