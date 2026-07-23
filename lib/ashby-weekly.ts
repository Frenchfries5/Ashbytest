import {
  ashbyConfigured,
  listApplicationsSince,
  listOpenJobs,
  isRelevantApplication,
} from '@/lib/ashby'

// How far back to reconstruct weekly history.
const HISTORY_DAYS = 365

// Matches the evergreen "perpetual job listing" the Ashby Inbound tab tracks.
const EVERGREEN_TITLE = /general interest|evergreen|talent (community|pool|network)|inbound/i

// Coverdash's designated evergreen inbound posting ("Commercial Insurance Broker, Growth").
// Its title does NOT match EVERGREEN_TITLE, so pin its id as the committed default. Without
// this, a deployment that lacks the ASHBY_INBOUND_JOB_ID env var (e.g. Vercel, since the var
// lives only in gitignored .env.local) would auto-detect the wrong "General Interest" job —
// which only has ~3 months of history and made the Inbound tab appear to start in April.
const DEFAULT_INBOUND_JOB_ID = '824849e5-2410-439d-8f26-e9d818019ad2'

// The Ashby Inbound tab is about ONE evergreen posting, not every req (that would also
// wrongly fold in outbound-sourced candidates and pull thousands of rows). Resolve the job:
// explicit env override → committed default (the Growth job) → regex auto-detect fallback.
async function resolveInboundJobId(): Promise<string | undefined> {
  const explicit = process.env.ASHBY_INBOUND_JOB_ID
  if (explicit) return explicit
  if (DEFAULT_INBOUND_JOB_ID) return DEFAULT_INBOUND_JOB_ID
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

export interface WeeklyRow { fullLabel: string; applicants: number; relevant: number }

export async function getAshbyWeeklyRows(): Promise<{ configured: boolean; rows: WeeklyRow[] }> {
  if (!ashbyConfigured()) return { configured: false, rows: [] }

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

  return { configured: true, rows }
}
