import { NextResponse } from 'next/server'
import { getWeeklyHireCounts } from '@/lib/ashby-hires'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await getWeeklyHireCounts()
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: String(err instanceof Error ? err.message : err), weeks: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
