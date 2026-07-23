import { ashbyConfigured, listHiredApplications } from '@/lib/ashby'
import { DAY, weekStartUTC, weekLabel } from '@/lib/week'

// Weekly hire counts, org-wide. Ashby has no hire-date field — a hire is approximated as the
// `updatedAt` of a terminal `Hired`-status application (see lib/ashby.ts:listHiredApplications).

export interface WeeklyHireCount {
  weekStart: string // ISO date (YYYY-MM-DD), Monday of the week
  label: string
  count: number
}

export async function getWeeklyHireCounts(
  weekCount = 5
): Promise<{ configured: boolean; weeks: WeeklyHireCount[] }> {
  if (!ashbyConfigured()) return { configured: false, weeks: [] }

  const hires = await listHiredApplications()
  const currentMonday = weekStartUTC(Date.now())
  const start = currentMonday - (weekCount - 1) * 7 * DAY

  const counts = new Map<number, number>()
  for (const h of hires) {
    if (!h.updatedAt) continue
    const t = Date.parse(h.updatedAt)
    if (isNaN(t) || t < start) continue
    const wk = weekStartUTC(t)
    counts.set(wk, (counts.get(wk) ?? 0) + 1)
  }

  const weeks: WeeklyHireCount[] = []
  for (let wk = start; wk <= currentMonday; wk += 7 * DAY) {
    weeks.push({ weekStart: new Date(wk).toISOString().slice(0, 10), label: weekLabel(wk), count: counts.get(wk) ?? 0 })
  }
  return { configured: true, weeks }
}
