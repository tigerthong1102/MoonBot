import { describe, expect, it, vi } from "vitest";
import { RoutineEmailDeliveries } from "./routine-email-deliveries.ts";
import type { RoutineRun } from "./routines.ts";

const owner = { botId: "bot", threadId: "chat" };
const to = "customer@example.test";
const response = { accepted: [to], rejected: [], messageId: "<fixture@example.test>" };

function fixture() {
  let disk = JSON.stringify([{ id: "run", ...owner, status: "running" }]);
  const restart = () => {
    const rows: RoutineRun[] = JSON.parse(disk);
    return new RoutineEmailDeliveries(() => rows, write => { write(); disk = JSON.stringify(rows); }, Date.now);
  };
  return { restart };
}

describe("routine email report delivery", () => {
  it("restarts before a send, preserves the server ACK and deduplicates a replay", async () => {
    const f = fixture(), smtp = vi.fn(async () => response);
    await expect(f.restart().send("run", owner, to, smtp)).resolves.toMatchObject({ receipt: { state: "accepted", messageId: response.messageId } });
    await expect(f.restart().send("run", owner, "customer@EXAMPLE.TEST", smtp)).resolves.toMatchObject({ receipt: { state: "accepted" }, repeated: true });
    expect(smtp).toHaveBeenCalledTimes(1);
  });

  it("keeps a lost ACK unconfirmed across restart and does not resend in flight", async () => {
    const f = fixture(), live = f.restart(), smtp = vi.fn(async () => response);
    const lostAck = live.send("run", owner, to, async () => {
      expect(await live.send("run", owner, to, smtp)).toMatchObject({ receipt: { state: "unconfirmed" }, repeated: true });
      throw new Error("lost SMTP acknowledgement");
    });
    expect(await lostAck).toMatchObject({ receipt: { state: "unconfirmed" } });
    expect(await f.restart().send("run", owner, to, smtp)).toMatchObject({ receipt: { state: "unconfirmed" }, repeated: true });
    expect(smtp).not.toHaveBeenCalled();
  });

  it("records rejection for the intended recipient and refuses another thread", async () => {
    const f = fixture();
    expect(await f.restart().send("run", owner, to, async () => ({ ...response, accepted: [], rejected: [to] }))).toMatchObject({ receipt: { state: "rejected" } });
    await expect(f.restart().send("run", { ...owner, threadId: "other" }, to, async () => response)).rejects.toThrow("no longer running");
  });
});
