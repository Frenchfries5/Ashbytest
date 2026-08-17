import { NextRequest, NextResponse } from 'next/server'
import { getWeeklyDigest } from '@/lib/ashby-digest'

export const dynamic = 'force-dynamic'

// Thin wrapper — the logic lives in lib/ashby-digest.ts so the weekly email can call it directly
// rather than HTTP-fetching this route from the server.
export async function GET(req: NextRequest) {
  try {
    const role = req.nextUrl.searchParams.get('role') ?? undefined
    const weeksAgo = Number(req.nextUrl.searchParams.get('weeksAgo') ?? 0)
    const digest = await getWeeklyDigest({ role, weeksAgo: Number.isFinite(weeksAgo) ? weeksAgo : 0 })
    return NextResponse.json(digest, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
