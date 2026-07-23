import { NextResponse } from 'next/server'
import { getRecruiterScreensScorecard } from '@/lib/ashby-interviews'

export const dynamic = 'force-dynamic'

// Recruiter screens completed this week / last week, from the synced ashby_interviews table.
export async function GET() {
  try {
    const sc = await getRecruiterScreensScorecard()
    if (!sc) {
      return NextResponse.json({ configured: false, thisWeek: 0, lastWeek: null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ configured: true, ...sc }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err), thisWeek: 0, lastWeek: null },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
