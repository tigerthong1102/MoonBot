import { describe, expect, it } from "vitest";
import { turnStartLogLine } from "./turn-log.ts";

describe("turnStartLogLine", () => {
  const turn = { botId: "bot-1", text: "what is six times seven", images: 0, depth: 0, card: false };

  it("logs only metadata when a turn contains typed text", () => {
    expect(turnStartLogLine({ ...turn, spoken: false })).toBe(
      '[omb-turn] bot=bot-1 input=typed images=0 depth=0 card=false',
    );
  });

  it("never logs words spoken on a Live call", () => {
    const line = turnStartLogLine({ ...turn, images: 1, depth: 0, card: true, spoken: true });
    expect(line).not.toContain("six times seven");
    expect(line).toBe("[omb-turn] bot=bot-1 input=spoken images=1 depth=0 card=true");
  });
});
