import { NextRequest, NextResponse } from 'next/server'
import { syncAshbyCache, getCacheSyncedAt, type CacheSyncMode } from '@/lib/ashby-cache-sync'
import { ashbyConfigured } from '@/lib/ashby'

export const dynamic = 'force-dynamic'
// Incremental syncs are ~1s. A full backfill is ~96s and must be run locally (dev ignores this).
export const maxDuration = 60

const NOSTORE = { 'Cache-Control': 'no-store' }

// Don't re-sync more often than this from page loads — several viewers opening the dashboard at
// once would otherwise each kick off their own sync.
const MIN_REVALIDATE_MS = 60_000

// Mirrors the other cron routes: if CRON_SECRET is set, GET callers must present it.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (req.nextUrl.searchParams.get('secret') === secret) return true
  return false
}

async function run(mode: CacheSyncMode) {
  const summary = await syncAshbyCache(mode)
  return NextResponse.json({ ok: true, ...summary }, { headers: NOSTORE })
}

// GET = Vercel Cron (daily) and manual/backfill curls, gated by CRON_SECRET.
export async function GET(req: NextRequest) {
  if (!ashbyConfigured()) {
    return NextResponse.json({ ok: false, error: 'ASHBY_API_KEY not set' }, { status: 400, headers: NOSTORE })
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NOSTORE })
  }
  const mode: CacheSyncMode = req.nextUrl.searchParams.get('mode') === 'backfill' ? 'backfill' : 'incremental'
  try {
    return await run(mode)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: NOSTORE }
    )
  }
}

// POST = the dashboard's on-load revalidate (stale-while-revalidate). Always incremental, and
// throttled so concurrent viewers don't each trigger a sync. Not secret-gated: it only refreshes
// the cache from Ashby using server-side credentials, and the throttle bounds the work.
export async function POST() {
  if (!ashbyConfigured()) {
    return NextResponse.json({ ok: false, error: 'ASHBY_API_KEY not set' }, { status: 400, headers: NOSTORE })
  }
  try {
    const last = await getCacheSyncedAt()
    const lastMs = last ? Date.parse(last) : NaN
    if (!isNaN(lastMs) && Date.now() - lastMs < MIN_REVALIDATE_MS) {
      return NextResponse.json({ ok: true, skipped: true, syncedAt: last }, { headers: NOSTORE })
    }
    return await run('incremental')
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: NOSTORE }
    )
  }
}
