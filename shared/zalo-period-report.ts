export type ZaloReportCadence = "hourly" | "daily";
export interface ZaloReportSchedule { cadence: ZaloReportCadence; hour: number; minute: number; timeZone: string }
export interface ZaloPeriodResult {
  start: number; end: number; timeZone: string; count: number; examined: number; urgent: number; gaps: number;
}
export interface ZaloPeriodView {
  source: { accountId: string; conversationId: string; senderId: string };
  revision: string; schedule: ZaloReportSchedule | null; next: number | null; periods: ZaloPeriodResult[];
}
