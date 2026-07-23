import { NextResponse } from 'next/server'
import { getWeeklySourcing } from '@/lib/sourcing'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const weeks = await getWeeklySourcing()
    return NextResponse.json({ weeks }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { weeks: [], error: err instanceof Error ? err.message : String(err) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
