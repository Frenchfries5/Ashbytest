import { NextResponse } from 'next/server'
import { isRelevantApplication } from '@/lib/ashby'
import { queryApplications, toApplication, type CachedAppRow } from '@/lib/ashby-cache'
import { resolveInboundJobId } from '@/lib/ashby-weekly'

export const dynamic = 'force-dynamic'

// The Ashby side of the inbound funnel for the evergreen req (the Growth broker job — also what
// ~79 of 82 tracked LinkedIn posts advertise).
//
// Returns TWO scopes, because mixing them is misleading:
//   • linkedin — applications Ashby attributes to a LinkedIn source. This is the only scope that
//     can be compared against the LinkedIn posting tracker: same population, so the step-to-step
//     percentage is a real conversion.
//   • all      — every application to the req regardless of channel (referrals, booking link,
//     direct applies…). Useful as context, but it is NOT a conversion of LinkedIn traffic.
//
// Still not a per-post join: the tracker and Ashby share no key, posts overlap on ~40% of live
// days, and applications arrive after a post goes live.

const LINKEDIN = /linkedin/i

export interface FunnelScope {
  applications: number
  advanced: number // inferred from stage/archive-reason, not a logged screening event
  hired: number
  monthly: { month: string; applications: number; advanced: number; hired: number }[]
}

function summarize(rows: CachedAppRow[]): FunnelScope {
  let advanced = 0
  let hired = 0
  const months = new Map<string, { month: string; applications: number; advanced: number; hired: number }>()

  for (const r of rows) {
    const isAdv = isRelevantApplication(toApplication(r))
    const isHired = r.status === 'Hired'
    if (isAdv) advanced += 1
    if (isHired) hired += 1
    if (r.created_at) {
      const key = r.created_at.slice(0, 7)
      const m = months.get(key) ?? { month: key, applications: 0, advanced: 0, hired: 0 }
      m.applications += 1
      if (isAdv) m.advanced += 1
      if (isHired) m.hired += 1
      months.set(key, m)
    }
  }

  return {
    applications: rows.length,
    advanced,
    hired,
    monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  }
}

export async function GET() {
  try {
    const jobId = await resolveInboundJobId()
    const rows = await queryApplications(jobId ? { jobId } : {})
    if (!rows) {
      return NextResponse.json(
        { configured: false, dataStart: null, linkedin: null, all: null, sources: [] },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    let dataStart: string | null = null
    const srcMap = new Map<string, { source: string; applications: number; hired: number }>()
    for (const r of rows) {
      if (r.created_at && (!dataStart || r.created_at < dataStart)) dataStart = r.created_at
      const sk = r.source ?? 'Unknown'
      const s = srcMap.get(sk) ?? { source: sk, applications: 0, hired: 0 }
      s.applications += 1
      if (r.status === 'Hired') s.hired += 1
      srcMap.set(sk, s)
    }

    return NextResponse.json(
      {
        configured: true,
        jobId: jobId ?? null,
        dataStart,
        linkedin: summarize(rows.filter((r) => LINKEDIN.test(r.source ?? ''))),
        all: summarize(rows),
        sources: [...srcMap.values()].sort((a, b) => b.applications - a.applications),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err), dataStart: null, linkedin: null, all: null, sources: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
