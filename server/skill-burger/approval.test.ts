import { expect, it } from "vitest";

import { createWorkflowApprovals } from "./approval.ts";

it("requires a one-time answer from the same conversation and stops after revocation", async () => {
  const events: Array<{ threadId: string; type: string; requestId: string }> = [];
  const gate = createWorkflowApprovals((threadId, event) => events.push({ threadId, type: event.type, requestId: event.requestId }));
  const controller = new AbortController();
  let active = true;
  const pending = gate.ask({ threadId: "t1", tool: "Shell", summary: "Run a command", signal: controller.signal, active: () => active });
  const id = events[0]!.requestId;
  expect(gate.answer("t2", id, "allow")).toBe("unavailable");
  expect(gate.answer("t1", id, "allow")).toBe("allowed-once");
  expect(await pending).toBe(true);
  expect(gate.answer("t1", id, "allow")).toBe("unavailable");
  const revoked = gate.ask({ threadId: "t1", tool: "Shell", summary: "Run another command", signal: controller.signal, active: () => active });
  active = false;
  expect(gate.answer("t1", events.at(-1)!.requestId, "allow")).toBe("unavailable");
  controller.abort();
  expect(await revoked).toBe(false);
});
