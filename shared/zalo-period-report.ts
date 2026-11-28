import { normalizeCronSchedule } from "../packages/phone-protocol/src/routine-schedule.ts";
export function reportTimeZone(value: string): string | undefined {
  const zone = value.trim();
  const canonical = /^(?:UTC|GMT|Etc\/(?:UTC|GMT)|[+-]00:00)$/i.test(zone) ? "UTC" : zone;
  try { return normalizeCronSchedule({ type: "cron", expression: "0 12 * * *", timeZone: canonical }).timeZone; }
  catch { return undefined; }
}
export type ZaloReportCadence = "hourly" | "daily";
export interface ZaloReportSchedule { cadence: ZaloReportCadence; hour: number; minute: number; timeZone: string }
export interface ZaloPeriodResult {
  start: number; end: number; timeZone: string; count: number; examined: number; urgent: number; gaps: number;
}
export interface ZaloPeriodView {
  source: { accountId: string; conversationId: string; senderId: string };
  revision: string; schedule: ZaloReportSchedule | null; next: number | null; periods: ZaloPeriodResult[];
}
