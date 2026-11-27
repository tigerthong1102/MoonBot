import type { RoutineInput } from "./routines";
import { intlLocale, t } from "./i18n";

export const businessTemplates = ["receivables", "meetings", "invoices"] as const;
export type BusinessTemplate = typeof businessTemplates[number];
const mail = ["Gmail", "Outlook"] as const;
export const templateSources = { receivables: mail, meetings: ["Google Calendar"], invoices: mail } as const;
export type BusinessSource = typeof templateSources[BusinessTemplate][number];
const access = { Gmail: "read-gmail", Outlook: "read-outlook", "Google Calendar": "read-calendar" } as const;
export const weekdayPresets = { everyday: "*", weekdays: "1-5", weekends: "0,6" } as const;

export interface BlueprintFields {
  template: BusinessTemplate;
  source: BusinessSource;
  recurrence: keyof typeof weekdayPresets;
  time: string;
  timeZone: string;
  days: 1 | 7 | 30;
}

export function buildBusinessRoutine(fields: BlueprintFields, botId: string, resultsThreadId?: string | null): RoutineInput {
  const { template, source, recurrence, time, timeZone, days } = fields;
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!clock || !Object.hasOwn(weekdayPresets, recurrence) || ![1, 7, 30].includes(days) ||
      !botId || !(templateSources[template] as readonly string[]).includes(source)) throw new Error(t("blueprint.invalid"));
  try { new Intl.DateTimeFormat(undefined, { timeZone }).format(0); } catch { throw new Error(t("blueprint.invalid")); }
  return {
    botId, resultsThreadId, enabled: false, name: t(`blueprint.${template}`),
    prompt: t(`blueprint.prompt.${template}`, { source, days }), access: access[source],
    schedule: { type: "cron", expression: `${Number(clock[2])} ${Number(clock[1])} * * ${weekdayPresets[recurrence]}`, timeZone },
  };
}

const sampleInvoices = [
  { id: "DEMO-001", daysAgo: 0, billed: 2_000_000, paid: 500_000 },
  { id: "DEMO-002", daysAgo: 4, billed: 900_000, paid: 900_000 },
  { id: "DEMO-003", daysAgo: 12, billed: 700_000, paid: 0 },
];
const sampleMeetings = [{ id: "CAL-001", daysAhead: 0, time: "09:00" }, { id: "CAL-002", daysAhead: 4, time: "14:30" }];

export function businessDemo({ template, days }: BlueprintFields): string[] {
  if (template === "meetings") return sampleMeetings.filter(row => row.daysAhead < days)
    .map(row => t("blueprint.demoMeeting", { id: row.id, day: row.daysAhead + 1, time: row.time }));
  const money = new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "VND" });
  return sampleInvoices.filter(row => row.daysAgo < days && (template === "invoices" || row.billed > row.paid))
    .map(row => t(template === "receivables" ? "blueprint.demoBalance" : "blueprint.demoInvoice",
      { id: row.id, amount: money.format(template === "receivables" ? row.billed - row.paid : row.billed) }));
}
