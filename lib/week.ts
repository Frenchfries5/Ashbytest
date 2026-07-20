// Shared week-bucketing helpers (UTC, Monday-start) used by the MeetAlfred DB-backed routes.

export const DAY = 86_400_000
export const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Monday 00:00 UTC of the week containing `ms`.
export function weekStartUTC(ms: number): number {
  const d = new Date(ms)
  const dow = (d.getUTCDay() + 6) % 7 // Mon = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)
}

// "Apr 14–20" — Monday to Sunday of the week.
export function weekLabel(mondayMs: number): string {
  const mon = new Date(mondayMs)
  const sun = new Date(mondayMs + 6 * DAY)
  const a = `${MON_SHORT[mon.getUTCMonth()]} ${mon.getUTCDate()}`
  const b =
    mon.getUTCMonth() === sun.getUTCMonth()
      ? `${sun.getUTCDate()}`
      : `${MON_SHORT[sun.getUTCMonth()]} ${sun.getUTCDate()}`
  return `${a}–${b}`
}

// True if `weekStart` (a week's Monday, ISO date) is the Monday of the week containing "now" —
// i.e. this week is still in progress. Its counts always start at 0 and climb through the week,
// so it's excluded from trend charts/averages (a real dip, not a data problem) and tagged "live"
// wherever it's still listed.
export function isCurrentWeekStart(weekStart: string | undefined): boolean {
  if (!weekStart) return false
  return Date.parse(weekStart) === weekStartUTC(Date.now())
}
