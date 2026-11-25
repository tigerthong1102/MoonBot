import { describe, expect, it } from "vitest";
import { botUsername } from "./bot-username.ts";

describe("bot usernames", () => {
  it("is stable and distinguishes UUIDs from older IDs, case and Unicode", () => {
    const ids = ["4c2b688e-2b84-42c8-9a63-8097258215b9", "4c2b688e-2b84-42c8-9a63-8097258215ba", "Bot", "bot", "bot_u4c2b688e2b8442c89a638097258215b9", "kiểm-kho", "🤖"];
    const names = ids.map(botUsername);
    expect(new Set(names).size).toBe(ids.length);
    expect(ids.map(botUsername)).toEqual(names);
    expect(names.every((name) => /^[a-z0-9_]+$/.test(name))).toBe(true);
  });
});
