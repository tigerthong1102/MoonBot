import { describe, expect, it } from "vitest";
import { incidentReminderDue, routineIncidents } from "./routine-incidents.ts";

const hour = 3_600_000;
const failed = (id: string, scheduledFor: number, error: string) => ({ id, routineId: "report", status: "failed", scheduledFor, error });

describe("routine incidents", () => {
  it("retains interleaved causes and resolves them together on success", () => {
    const runs = Array.from({ length: 20 }, (_, i) => failed(String(i), i, `timed out in ${i + 1} seconds`));
    const other = failed("other", 8, "connector returned 401");
    const success = { ...runs[0]!, id: "ok", status: "completed", scheduledFor: 20 };
    const again = failed("again", 21, "timed out in 3 seconds");
    const cases = routineIncidents([...runs, other, success, again]);
    expect(cases.get("19")).toMatchObject({ firstAt: 0, lastAt: 19, runs: runs.map(r => r.id), resolved: true });
    expect(cases.get("other")).toMatchObject({ runs: ["other"], resolved: true });
    expect(cases.get("again")).toMatchObject({ runs: ["again"], resolved: false });
  });

  it("repeats a reminder after the cooldown and silences a seen cause until recovery", () => {
    const first = { ...failed("a", 0, "401"), incidentReminderAt: 0 };
    const other = failed("b", hour, "500");
    const early = failed("c", 47 * hour, "401");
    const late = failed("d", 49 * hour, "401");
    expect(incidentReminderDue([first, other], other)).toBe(true);
    expect(incidentReminderDue([first, other, early], early)).toBe(false);
    expect(incidentReminderDue([first, early, late], late)).toBe(true);
    expect(incidentReminderDue([{ ...first, seenAt: hour }, late], late)).toBe(false);
  });
});
