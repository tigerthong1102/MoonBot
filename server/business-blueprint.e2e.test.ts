import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { Routine, RoutineRun } from "./routines.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

it("persists the selected template paused and retains its source fence on manual run", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_REPLY: "Draft: DEMO-001" });
  try {
    const { url } = fixture.info;
    const api = async (path: string, body?: object) => {
      const response = await fetch(url + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin: url }, body: body ? JSON.stringify(body) : undefined });
      expect(response.ok, path).toBe(true);
      return response.json();
    };
    const { bot } = await runControlOmb(["new-bot", "--name", "Accounts", "--url", url]) as { bot: { id: string } };
    const input = { name: "Receivables review", prompt: "Read Outlook for invoices and cite each message ID.", botId: bot.id,
      enabled: false, access: "read-outlook", schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "Asia/Ho_Chi_Minh" } };
    const { routine } = await api("/api/routines", input) as { routine: Routine };
    expect(routine).toMatchObject({ enabled: false, access: "read-outlook", schedule: input.schedule });
    expect((await api("/api/routines") as { runs: RoutineRun[] }).runs.some(run => run.routineId === routine.id)).toBe(false);
    await api(`/api/routines/${routine.id}/run`, {});
    await expect.poll(async () => (await api("/api/routines") as { runs: RoutineRun[] }).runs.find(run => run.routineId === routine.id), { timeout: hostTimeout(40_000) })
      .toMatchObject({ status: "completed", access: "read-outlook" });
  } finally { await fixture.close(); }
}, hostTimeout(90_000));
