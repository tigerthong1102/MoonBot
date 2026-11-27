import { expect, it } from "vitest";
import { buildBusinessRoutine, businessDemo, type BlueprintFields } from "./business-automations";

const fields: BlueprintFields = { template: "receivables", source: "Outlook", days: 7, time: "08:05", timeZone: "Asia/Ho_Chi_Minh", recurrence: "weekdays" };

it("installs a paused, single-source routine with an explicit audience and timezone", () => {
  expect(buildBusinessRoutine(fields, "accounts", "just-me")).toMatchObject({
    enabled: false, access: "read-outlook", resultsThreadId: "just-me", botId: "accounts",
    schedule: { type: "cron", expression: "5 8 * * 1-5", timeZone: fields.timeZone },
    prompt: expect.stringContaining("7 days"),
  });
  for (const invalid of [{ time: "44:05" }, { timeZone: "Bad/Zone" }, { source: "Google Calendar" as const }])
    expect(() => buildBusinessRoutine({ ...fields, ...invalid }, "accounts")).toThrow();
});

it("computes a draft from the sample records inside the chosen period", () => {
  expect(businessDemo(fields)).toEqual([expect.stringContaining("DEMO-001")]);
  expect(businessDemo({ ...fields, days: 30 })).toHaveLength(2);
  expect(businessDemo({ ...fields, template: "invoices" })).toHaveLength(2);
  expect(businessDemo({ ...fields, template: "meetings", days: 1 })).toEqual([expect.stringContaining("CAL-001")]);
});
