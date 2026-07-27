import { NextResponse } from 'next/server'
import { isRelevantApplication } from '@/lib/ashby'
import { queryApplications, toApplication } from '@/lib/ashby-cache'

export const dynamic = 'force-dynamic'

// Per-source funnel from the Ashby cache: applications → advanced past screening → hired.
// This is what extends the Inbound Postings story past "relevant" to actual outcomes: the
// postings tracker measures views/applicants/relevant per post, but only Ashby knows who
// eventually got hired, and it records the channel each application came from.
//
// Attribution note: this is CHANNEL-level, not per-post — the two systems share no key, so a
// specific LinkedIn post can't be tied to a specific hire. `dataStart` is surfaced because the
// Ashby account's application history begins well after the postings tracker does.

export interface SourceOutcome {
  source: string
  applications: number
  advanced: number   // past initial screening (isRelevantApplication)
  hired: number
  hireRate: number   // hired / applications, %
}

export async function GET() {
  try {
    const rows = await queryApplications()
    if (!rows) {
      return NextResponse.json({ configured: false, sources: [], dataStart: null }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const agg = new Map<string, SourceOutcome>()
    let earliest: string | null = null

    for (const r of rows) {
      if (r.created_at && (!earliest || r.created_at < earliest)) earliest = r.created_at
      const key = r.source ?? 'Unknown'
      const e = agg.get(key) ?? { source: key, applications: 0, advanced: 0, hired: 0, hireRate: 0 }
      e.applications += 1
      if (r.status === 'Hired') e.hired += 1
      if (isRelevantApplication(toApplication(r))) e.advanced += 1
      agg.set(key, e)
    }

    const sources = [...agg.values()]
      .map((s) => ({ ...s, hireRate: s.applications ? (s.hired / s.applications) * 100 : 0 }))
      .sort((a, b) => b.applications - a.applications)

    return NextResponse.json(
      { configured: true, sources, dataStart: earliest },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err), sources: [], dataStart: null },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
