import { NextRequest, NextResponse } from 'next/server'
import { getScorecardAnalytics } from '@/lib/ashby-scorecards'

export const dynamic = 'force-dynamic'

// Thin wrapper — the analysis lives in lib/ashby-scorecards.ts. `?jobId=` scopes everything to one
// role; omitted means all roles pooled.
export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get('jobId')
    const data = await getScorecardAnalytics({ jobId: jobId || null })
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
