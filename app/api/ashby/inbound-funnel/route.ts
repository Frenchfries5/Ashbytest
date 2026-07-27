import { NextResponse } from 'next/server'
import { isRelevantApplication } from '@/lib/ashby'
import { queryApplications, toApplication } from '@/lib/ashby-cache'
import { resolveInboundJobId } from '@/lib/ashby-weekly'

export const dynamic = 'force-dynamic'

// The Ashby side of the inbound funnel, scoped to the SAME evergreen job the Ashby Inbound view
// tracks (the Growth broker req — which is also what ~79 of 82 tracked LinkedIn posts advertise).
// This is what lets the merged Inbound tab show "ads → applications → outcomes" end to end.
//
// Deliberately NOT a per-post join: the postings tracker and Ashby share no key, LinkedIn's
// "applicants" counts clicks-to-apply rather than completed ATS applications, and posts overlap on
// ~40% of live days. So this reports the Ashby end on its own terms and the UI compares totals.

export async function GET() {
  try {
    const jobId = await resolveInboundJobId()
    const rows = await queryApplications(jobId ? { jobId } : {})
    if (!rows) {
      return NextResponse.json(
        { configured: false, applications: 0, advanced: 0, hired: 0, monthly: [], sources: [], dataStart: null },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    let advanced = 0
    let hired = 0
    let dataStart: string | null = null
    const monthMap = new Map<string, { month: string; applications: number; advanced: number; hired: number }>()
    const srcMap = new Map<string, { source: string; applications: number; hired: number }>()

    for (const r of rows) {
      const isAdv = isRelevantApplication(toApplication(r))
      const isHired = r.status === 'Hired'
      if (isAdv) advanced += 1
      if (isHired) hired += 1
      if (r.created_at && (!dataStart || r.created_at < dataStart)) dataStart = r.created_at

      if (r.created_at) {
        const key = r.created_at.slice(0, 7)
        const m = monthMap.get(key) ?? { month: key, applications: 0, advanced: 0, hired: 0 }
        m.applications += 1
        if (isAdv) m.advanced += 1
        if (isHired) m.hired += 1
        monthMap.set(key, m)
      }

      const sk = r.source ?? 'Unknown'
      const s = srcMap.get(sk) ?? { source: sk, applications: 0, hired: 0 }
      s.applications += 1
      if (isHired) s.hired += 1
      srcMap.set(sk, s)
    }

    return NextResponse.json(
      {
        configured: true,
        jobId: jobId ?? null,
        applications: rows.length,
        advanced,
        hired,
        dataStart,
        monthly: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
        sources: [...srcMap.values()].sort((a, b) => b.applications - a.applications),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err), applications: 0, advanced: 0, hired: 0, monthly: [], sources: [], dataStart: null },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
