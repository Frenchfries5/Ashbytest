import { NextResponse } from 'next/server'
import {
  ashbyConfigured,
  listJobCandidates,
  listAllJobApplications,
  getDaysInCurrentStage,
  mapLimit,
  isRelevantStage,
} from '@/lib/ashby'

export const dynamic = 'force-dynamic'

// Cap per-candidate history lookups so a huge active pipeline doesn't fan out unbounded.
const MAX_HISTORY_LOOKUPS = 120

// Heavier analytics for one job — loaded separately from the drawer's fast path so it can
// stream in: full-funnel source→outcome breakdown, archive reasons, and accurate
// time-in-current-stage per active candidate.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!ashbyConfigured()) {
    return NextResponse.json(
      { configured: false, sourceBreakdown: [], archiveReasons: [], stageTiming: {} },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const [allApps, candidates] = await Promise.all([
      listAllJobApplications(id),
      listJobCandidates(id),
    ])

    // ── Source → outcome (which channels advance) ──
    interface SrcAgg { source: string; total: number; hired: number; advanced: number; early: number; archived: number }
    const bySource = new Map<string, SrcAgg>()
    for (const a of allApps) {
      const key = a.source ?? 'Unknown'
      const b = bySource.get(key) ?? { source: key, total: 0, hired: 0, advanced: 0, early: 0, archived: 0 }
      b.total += 1
      if (a.status === 'Hired') b.hired += 1
      else if (a.status === 'Archived') b.archived += 1
      else if (isRelevantStage(a.stage)) b.advanced += 1 // Active/Lead past screening
      else b.early += 1
      bySource.set(key, b)
    }
    const sourceBreakdown = Array.from(bySource.values()).sort((a, b) => b.total - a.total)

    // ── Who was hired ──
    const hired = allApps
      .filter((a) => a.status === 'Hired')
      .map((a) => ({ name: a.name, source: a.source }))

    // ── Why candidates were archived ──
    const byReason = new Map<string, number>()
    for (const a of allApps) {
      if (a.status !== 'Archived') continue
      const r = a.archiveReason ?? 'No reason given'
      byReason.set(r, (byReason.get(r) ?? 0) + 1)
    }
    const archiveReasons = Array.from(byReason.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)

    // ── Accurate time-in-current-stage per active candidate (applicationId -> days) ──
    const stageTiming: Record<string, number | null> = {}
    if (candidates.length <= MAX_HISTORY_LOOKUPS) {
      const times = await mapLimit(candidates, 10, (c) => getDaysInCurrentStage(c.applicationId))
      candidates.forEach((c, i) => { stageTiming[c.applicationId] = times[i] })
    }

    return NextResponse.json(
      {
        configured: true,
        totalApplicants: allApps.length,
        hired,
        sourceBreakdown,
        archiveReasons,
        stageTiming,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: String(err instanceof Error ? err.message : err), sourceBreakdown: [], archiveReasons: [], stageTiming: {} },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
