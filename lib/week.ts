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
