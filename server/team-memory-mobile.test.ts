import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { OptionCardData } from "../shared/wire.ts";
import { TeamMemory } from "./team-memory.ts";
import { createTeamMemoryRequests } from "./team-memory-requests.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it.each([["Skip", "deny", false], ["Remember", "allow", true]] as const)("the native %s decision preserves the real team-memory contract", async (choice, behavior, accepted) => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-memory-mobile-"));
  try {
    const memory = new TeamMemory(join(dir, "team-memory.json"));
    const speaker = { id: "bot", name: "Fixture", color: "blue" };
    let message: { id: string; card: OptionCardData } | undefined;
    const requests = createTeamMemoryRequests({
      teamMemory: memory,
      store: {
        messagesFor: () => message ? [message] : [],
        appendMessage: (_thread, value) => { message = { id: "memory-card", card: value.card }; return message; },
        patchMessage: (_thread, _id, patch) => { if (message) message.card = patch.card; },
        bot: () => speaker,
        botByThread: () => speaker,
      },
      sectionKey: () => "main",
      decide: () => {},
    });
    requests.submit(speaker, "thread", false, { kind: "term", name: "billing period", detail: "Monthly" }, null);
    const card = message!.card;
    const fixture = JSON.parse(readFileSync(new URL("../ios/Tests/CompanionCoreTests/Fixtures/team-memory-request.json", import.meta.url), "utf8"));
    expect({ ...card, requestId: "memory-request", teamMemoryRequest: { ...card.teamMemoryRequest, entryId: "memory-request" } }).toEqual(fixture.card);
    expect(fixture.card.options).toContain(choice);
    expect(requests.resolve("thread", card.requestId!, behavior)).not.toBeNull();
    expect(message!.card.answered).toBe(behavior);
    expect(memory.list("").some((entry) => entry.id === card.requestId)).toBe(accepted);
  } finally { await removeTempDir(dir); }
});
