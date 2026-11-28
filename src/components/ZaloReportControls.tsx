import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { matchesZaloReport, ZALO_REPORT_FILTERS, type ZaloReportFilter, type ZaloReportRow } from "../../shared/zalo-intelligence";
import { Select } from "./Select";
import { SETTINGS_INPUT, SettingsField } from "./SettingsPrimitives";

export function ZaloReportControls({ rows, source, filter, onFilter }: {
  rows: ZaloReportRow[]; source: string; filter: ZaloReportFilter; onFilter: (next: ZaloReportFilter) => void;
}) {
  const counts = useMemo(() => new Map(ZALO_REPORT_FILTERS.map(key => [key, rows.filter(row => matchesZaloReport(row, key)).length])), [rows]);
  return <>
    <p role="status">{t("zalo.coverage", { source, count: rows.length, urgent: counts.get("urgent") ?? 0 })}</p>
    <p className="text-ink-secondary">{t("zalo.report.summary", { tasks: counts.get("task") ?? 0, deadlines: counts.get("deadline") ?? 0, repeats: counts.get("duplicate") ?? 0 })}</p>
    <SettingsField label={t("zalo.report.filter")} hint={t("zalo.report.time")}>
      <Select className={SETTINGS_INPUT} value={filter} onChange={event => {
        const next = ZALO_REPORT_FILTERS.find(key => key === event.target.value);
        if (next) onFilter(next);
      }}>
        {ZALO_REPORT_FILTERS.map(key => <option value={key} key={key}>{t(`zalo.report.filter.${key}`)} ({counts.get(key)})</option>)}
      </Select>
    </SettingsField>
  </>;
}
