import { NextRequest, NextResponse } from 'next/server'
import { syncMeetAlfredEvents, type SyncMode } from '@/lib/meetalfred-sync'
import { meetalfredConfigured } from '@/lib/meetalfred'

export const dynamic = 'force-dynamic'
// Incremental syncs are quick; this bounds the deployed function. Backfill is only ever run
// locally (dev server ignores this), since it pages minutes of history.
export const maxDuration = 60

// Optional protection. If CRON_SECRET is set, callers must present it (Vercel Cron sends it as
// `Authorization: Bearer <secret>`); `?secret=` also works for manual curls. If unset, the
// route is open — fine for an internal/dev tool, but set CRON_SECRET before relying on cron
// in production. (Note: with CRON_SECRET set, the in-page "Sync now" button would also need it.)
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (req.nextUrl.searchParams.get('secret') === secret) return true
  return false
}

async function handle(req: NextRequest) {
  if (!meetalfredConfigured()) {
    return NextResponse.json({ ok: false, error: 'MEETALFRED_API_KEY not set' }, { status: 400 })
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const mode: SyncMode = req.nextUrl.searchParams.get('mode') === 'backfill' ? 'backfill' : 'incremental'
  try {
    const summary = await syncMeetAlfredEvents(mode)
    return NextResponse.json({ ok: true, ...summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

// POST for the in-page button; GET for Vercel Cron and manual curls.
export const GET = handle
export const POST = handle
