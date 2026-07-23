import { NextResponse } from 'next/server'
import { getRecruiterScreenFunnel } from '@/lib/ashby-interviews'

export const dynamic = 'force-dynamic'

// Weekly recruiter-screen funnel (screens + moved forward), from the synced ashby_interviews table.
export async function GET() {
  try {
    const data = await getRecruiterScreenFunnel(12)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err), weeks: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
