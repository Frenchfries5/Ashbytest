import { NextResponse } from 'next/server'
import {
  ashbyConfigured,
  listApplicationsSince,
  listOpenJobs,
  isRelevantApplication,
} from '@/lib/ashby'

export const dynamic = 'force-dynamic'

// How far back to reconstruct weekly history.
const HISTORY_DAYS = 365

// Matches the evergreen "perpetual job listing" the Ashby Inbound tab tracks.
const EVERGREEN_TITLE = /general interest|evergreen|talent (community|pool|network)|inbound/i

// The Ashby Inbound tab is about ONE evergreen posting, not every req (that would also
// wrongly fold in outbound-sourced candidates and pull thousands of rows). Resolve the job:
// explicit env override first, else auto-detect the evergreen posting among open jobs.
async function resolveInboundJobId(): Promise<string | undefined> {
  const explicit = process.env.ASHBY_INBOUND_JOB_ID
  if (explicit) return explicit
  const jobs = await listOpenJobs()
  return jobs.find((j) => EVERGREEN_TITLE.test(j.title))?.id
}

const MON_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Monday 00:00 of the week containing `d` (local time).
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - dow)
  return x
}

function fullLabel(d: Date): string {
  return `${MON_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export async function GET() {
  if (!ashbyConfigured()) {
    return NextResponse.json(
      { configured: false, rows: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const since = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000
    const jobId = await resolveInboundJobId()
    const apps = await listApplicationsSince(since, jobId)

    // weekMondayMs -> counts
    const buckets = new Map<number, { date: Date; applicants: number; relevant: number }>()
    for (const a of apps) {
      if (!a.createdAt) continue
      const created = new Date(a.createdAt)
      if (isNaN(created.getTime())) continue
      const start = weekStart(created)
      const key = start.getTime()
      const b = buckets.get(key) ?? { date: start, applicants: 0, relevant: 0 }
      b.applicants += 1
      if (isRelevantApplication(a)) b.relevant += 1
      buckets.set(key, b)
    }

    const rows = Array.from(buckets.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((b) => ({
        fullLabel: fullLabel(b.date),
        applicants: b.applicants,
        relevant: b.relevant,
      }))

    return NextResponse.json(
      { configured: true, rows },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: String(err instanceof Error ? err.message : err), rows: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
