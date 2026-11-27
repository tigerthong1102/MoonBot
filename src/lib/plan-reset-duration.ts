// From stablyai/orca@457c42a9, src/shared/agent-usage/rate-limits/rate-limit-reset-format.ts.
// Copyright (c) 2026 Lovecast Inc., MIT. See public/licenses/orca.txt.
/** Floor durations to whole units (47m, 3h 54m, 6d 7h); nonpositive values return now for reset-specific copy. */
export function formatResetDuration(
  ms: number,
  formatUnit: (value: number, unit: 'minute' | 'hour' | 'day') => string = (value, unit) =>
    `${value}${unit === 'minute' ? 'm' : unit === 'hour' ? 'h' : 'd'}`
): string {
  if (ms <= 0) {
    return 'now'
  }
  const totalMins = Math.floor(ms / 60_000)
  if (totalMins < 60) {
    return formatUnit(totalMins, 'minute')
  }
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours > 0
      ? `${formatUnit(days, 'day')} ${formatUnit(remHours, 'hour')}`
      : formatUnit(days, 'day')
  }
  return mins > 0
    ? `${formatUnit(hours, 'hour')} ${formatUnit(mins, 'minute')}`
    : formatUnit(hours, 'hour')
}
