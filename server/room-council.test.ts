import { expect, it } from "vitest";
import { councilRequest, councilSeat, runCouncil, seats } from "./room-council.ts";

it("requires all three distinct seats before spending anything and rejects unsupported agent drivers", async () => {
  expect(councilSeat("grok-acp", "grok-agent")).toBeUndefined();
  expect(councilRequest("/councillor heckles")).toBeNull();
  const notices: string[] = [];
  await runCouncil({ question: "Why?", critique: false, members: [], signal: new AbortController().signal, post: () => { throw Error(); }, notice: x => notices.push(x) });
  expect(notices[0]).toContain("Claude, GPT, Grok");
});

it("keeps a missing ballot out of the chair’s evidence and preserves minority opinions", async () => {
  let summary = "";
  const members = seats.map(seat => ({ seat, model: seat, id: seat, ask: async (prompt: string) => {
    if (seat === "Grok") throw Error("disconnected");
    if (prompt.includes("Chair this council")) summary = prompt;
    return seat === "GPT" ? "hold" : "launch";
  } }));
  const errors: string[] = [];
  await runCouncil({ question: "Launch?", critique: false, members, signal: new AbortController().signal, post: () => {}, notice: x => errors.push(x) });
  expect(errors).toHaveLength(1);
  expect(summary).toContain("disagreement");
  expect(summary).toContain('"text":"hold"');
  expect(summary).toContain('"text":"launch"');
  expect(summary).not.toContain('"seat":"Grok"');
});
