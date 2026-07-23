import { NextRequest, NextResponse } from 'next/server'
import { syncAshbyInterviews, type InterviewSyncMode } from '@/lib/ashby-interviews-sync'
import { ashbyConfigured } from '@/lib/ashby'

export const dynamic = 'force-dynamic'
// Incremental syncs (syncToken) are quick; this bounds the deployed function. Backfill pages the
// full history and is only ever run locally (dev server ignores this).
export const maxDuration = 60

// Mirrors /api/meetalfred/sync. If CRON_SECRET is set, callers must present it (Vercel Cron sends
// `Authorization: Bearer <secret>`; `?secret=` also works). Open when unset.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (req.nextUrl.searchParams.get('secret') === secret) return true
  return false
}

async function handle(req: NextRequest) {
  if (!ashbyConfigured()) {
    return NextResponse.json({ ok: false, error: 'ASHBY_API_KEY not set' }, { status: 400 })
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const mode: InterviewSyncMode = req.nextUrl.searchParams.get('mode') === 'backfill' ? 'backfill' : 'incremental'
  try {
    const summary = await syncAshbyInterviews(mode)
    return NextResponse.json({ ok: true, ...summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

// POST for a manual trigger; GET for Vercel Cron and manual curls.
export const GET = handle
export const POST = handle
